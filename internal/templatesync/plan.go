package templatesync

import (
	"fmt"
	"path/filepath"
)

type Options struct {
	ManifestPath string
	LockPath     string
	TemplateDir  string
	TargetDir    string
	Repository   string
	Ref          string
}

func defaultOptions() Options {
	return Options{
		ManifestPath: "templates.yaml",
		LockPath:     ".template-sync.lock",
		TemplateDir:  ".",
		TargetDir:    ".",
	}
}

func buildPlan(opts Options) (Manifest, LockFile, []Change, error) {
	manifest, err := loadManifest(filepath.Join(opts.TemplateDir, opts.ManifestPath))
	if err != nil {
		return manifest, LockFile{}, nil, err
	}
	lock, err := loadLock(filepath.Join(opts.TargetDir, opts.LockPath))
	if err != nil {
		return manifest, lock, nil, err
	}

	manifestIDs := map[string]ManifestTemplate{}
	var changes []Change
	for _, item := range manifest.Template {
		manifestIDs[item.ID] = item
		sourcePath := filepath.Join(opts.TemplateDir, item.Source)
		targetPath := filepath.Join(opts.TargetDir, item.Target)
		sourceHash, sourceExists, err := fileHash(sourcePath)
		if err != nil {
			return manifest, lock, nil, fmt.Errorf("hash source %s: %w", item.Source, err)
		}
		if !sourceExists {
			return manifest, lock, nil, fmt.Errorf("source file does not exist: %s", item.Source)
		}
		currentHash, targetExists, err := fileHash(targetPath)
		if err != nil {
			return manifest, lock, nil, fmt.Errorf("hash target %s: %w", item.Target, err)
		}

		change := Change{
			ID:          item.ID,
			SourcePath:  sourcePath,
			TargetPath:  targetPath,
			SourceHash:  sourceHash,
			CurrentHash: currentHash,
			Status:      StatusSynced,
		}
		if locked, ok := lock.Files[item.ID]; ok {
			change.LockedHash = locked.SourceSHA256
		}
		switch {
		case !targetExists:
			change.Status = StatusAdd
			change.Reason = "target file is missing"
		case currentHash != sourceHash:
			change.Status = StatusUpdate
			change.Reason = "target differs from template"
		}
		changes = append(changes, change)
	}

	for id, item := range lock.Files {
		if _, ok := manifestIDs[id]; ok {
			continue
		}
		targetPath := filepath.Join(opts.TargetDir, item.Target)
		currentHash, targetExists, err := fileHash(targetPath)
		if err != nil {
			return manifest, lock, nil, fmt.Errorf("hash stale target %s: %w", item.Target, err)
		}
		change := Change{
			ID:          id,
			TargetPath:  targetPath,
			CurrentHash: currentHash,
			LockedHash:  item.SourceSHA256,
			Status:      StatusPrune,
			Reason:      "template was removed from manifest",
		}
		if targetExists && currentHash != item.SourceSHA256 {
			change.Status = StatusConflict
			change.Reason = "template was removed, but target has local changes"
		}
		changes = append(changes, change)
	}

	return manifest, lock, changes, nil
}

func hasDrift(changes []Change) bool {
	for _, change := range changes {
		if change.Status != StatusSynced {
			return true
		}
	}
	return false
}
