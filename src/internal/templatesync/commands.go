package templatesync

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

var errDrift = errors.New("template drift detected")

func Run(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		printUsage(stderr)
		return errors.New("command is required")
	}
	command := args[0]
	opts, rest, err := parseOptions(args[1:], stderr)
	if err != nil {
		return err
	}
	if len(rest) > 0 {
		return fmt.Errorf("unexpected arguments: %v", rest)
	}

	switch command {
	case "check":
		return runCheck(opts, stdout)
	case "diff":
		return runDiff(opts, stdout)
	case "update":
		return runUpdate(opts, stdout)
	case "prune":
		return runPrune(opts, stdout)
	case "help", "-h", "--help":
		printUsage(stdout)
		return nil
	default:
		printUsage(stderr)
		return fmt.Errorf("unknown command %q", command)
	}
}

func parseOptions(args []string, stderr io.Writer) (Options, []string, error) {
	opts := defaultOptions()
	fs := flag.NewFlagSet("template-sync", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&opts.ManifestPath, "manifest", opts.ManifestPath, "manifest path relative to template dir")
	fs.StringVar(&opts.LockPath, "lock", opts.LockPath, "lock file path relative to target dir")
	fs.StringVar(&opts.TemplateDir, "template-dir", opts.TemplateDir, "template repository directory")
	fs.StringVar(&opts.TargetDir, "target-dir", opts.TargetDir, "target repository directory")
	fs.StringVar(&opts.Repository, "repository", opts.Repository, "repository value written to lock file")
	fs.StringVar(&opts.Ref, "ref", opts.Ref, "ref value written to lock file")
	if err := fs.Parse(args); err != nil {
		return opts, nil, err
	}
	return opts, fs.Args(), nil
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, `usage: template-sync <command> [options]

commands:
  check   check whether target files match the template
  diff    show diffs for files that would be added or updated
  update  copy added/updated files and refresh the lock file
  prune   remove manifest-deleted files when they are unchanged locally

options:
  --template-dir string  template repository directory (default ".")
  --target-dir string    target repository directory (default ".")
  --manifest string      manifest path relative to template dir (default "templates.yaml")
  --lock string          lock file path relative to target dir (default ".template-sync.lock")
  --repository string    repository value written to lock file
  --ref string           ref value written to lock file`)
}

func runCheck(opts Options, stdout io.Writer) error {
	_, _, changes, err := buildPlan(opts)
	if err != nil {
		return err
	}
	printChanges(stdout, changes)
	if hasDrift(changes) {
		return errDrift
	}
	return nil
}

func runDiff(opts Options, stdout io.Writer) error {
	_, _, changes, err := buildPlan(opts)
	if err != nil {
		return err
	}
	for _, change := range sortedChanges(changes) {
		switch change.Status {
		case StatusAdd, StatusUpdate:
			if err := printGitDiff(stdout, change.SourcePath, change.TargetPath, change.Status == StatusAdd); err != nil {
				return err
			}
		case StatusPrune, StatusConflict:
			fmt.Fprintf(stdout, "%s %s: %s\n", change.Status, change.ID, change.Reason)
		}
	}
	if hasDrift(changes) {
		return errDrift
	}
	return nil
}

func runUpdate(opts Options, stdout io.Writer) error {
	manifest, lock, changes, err := buildPlan(opts)
	if err != nil {
		return err
	}
	if lock.Files == nil {
		lock.Files = map[string]LockItem{}
	}
	if opts.Repository != "" {
		lock.Repository = opts.Repository
	}
	if opts.Ref != "" {
		lock.Ref = opts.Ref
	}
	sourceByID := map[string]ManifestTemplate{}
	for _, item := range manifest.Template {
		sourceByID[item.ID] = item
	}
	for _, change := range sortedChanges(changes) {
		switch change.Status {
		case StatusAdd, StatusUpdate:
			if err := copyFile(change.SourcePath, change.TargetPath); err != nil {
				return fmt.Errorf("update %s: %w", change.ID, err)
			}
			item := sourceByID[change.ID]
			lock.Files[change.ID] = LockItem{Target: item.Target, SourceSHA256: change.SourceHash}
			fmt.Fprintf(stdout, "%s %s -> %s\n", change.Status, item.Source, item.Target)
		case StatusSynced:
			item := sourceByID[change.ID]
			lock.Files[change.ID] = LockItem{Target: item.Target, SourceSHA256: change.SourceHash}
		case StatusPrune, StatusConflict:
			fmt.Fprintf(stdout, "skip %s %s: %s\n", change.Status, change.ID, change.Reason)
		}
	}
	if err := writeLock(filepath.Join(opts.TargetDir, opts.LockPath), lock); err != nil {
		return err
	}
	return nil
}

func runPrune(opts Options, stdout io.Writer) error {
	_, lock, changes, err := buildPlan(opts)
	if err != nil {
		return err
	}
	for _, change := range sortedChanges(changes) {
		switch change.Status {
		case StatusPrune:
			if err := os.Remove(change.TargetPath); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("prune %s: %w", change.ID, err)
			}
			delete(lock.Files, change.ID)
			fmt.Fprintf(stdout, "prune %s\n", change.ID)
		case StatusConflict:
			fmt.Fprintf(stdout, "conflict %s: %s\n", change.ID, change.Reason)
		}
	}
	if err := writeLock(filepath.Join(opts.TargetDir, opts.LockPath), lock); err != nil {
		return err
	}
	return nil
}

func printChanges(w io.Writer, changes []Change) {
	for _, change := range sortedChanges(changes) {
		if change.Status == StatusSynced {
			continue
		}
		fmt.Fprintf(w, "%s %s: %s\n", change.Status, change.ID, change.Reason)
	}
	if !hasDrift(changes) {
		fmt.Fprintln(w, "synced")
	}
}

func sortedChanges(changes []Change) []Change {
	out := append([]Change(nil), changes...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Status == out[j].Status {
			return out[i].ID < out[j].ID
		}
		return out[i].Status < out[j].Status
	})
	return out
}

func printGitDiff(w io.Writer, sourcePath, targetPath string, targetMissing bool) error {
	left := targetPath
	if targetMissing {
		left = os.DevNull
	}
	cmd := exec.Command("git", "diff", "--no-index", "--", left, sourcePath)
	data, err := cmd.CombinedOutput()
	if len(data) > 0 {
		fmt.Fprint(w, string(data))
	}
	if err == nil {
		return nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
		return nil
	}
	return fmt.Errorf("run git diff: %w", err)
}
