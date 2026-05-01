package templatesync

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

func loadManifest(path string) (Manifest, error) {
	var manifest Manifest
	data, err := os.ReadFile(path)
	if err != nil {
		return manifest, fmt.Errorf("read manifest: %w", err)
	}
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return manifest, fmt.Errorf("parse manifest: %w", err)
	}
	if manifest.Version != 1 {
		return manifest, fmt.Errorf("unsupported manifest version %d", manifest.Version)
	}
	seen := map[string]struct{}{}
	for _, item := range manifest.Template {
		if item.ID == "" {
			return manifest, errors.New("manifest contains template without id")
		}
		if item.Source == "" || item.Target == "" {
			return manifest, fmt.Errorf("template %q must define source and target", item.ID)
		}
		if _, ok := seen[item.ID]; ok {
			return manifest, fmt.Errorf("duplicate template id %q", item.ID)
		}
		seen[item.ID] = struct{}{}
	}
	return manifest, nil
}

func loadLock(path string) (LockFile, error) {
	lock := LockFile{Files: map[string]LockItem{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return lock, nil
	}
	if err != nil {
		return lock, fmt.Errorf("read lock file: %w", err)
	}
	if err := yaml.Unmarshal(data, &lock); err != nil {
		return lock, fmt.Errorf("parse lock file: %w", err)
	}
	if lock.Files == nil {
		lock.Files = map[string]LockItem{}
	}
	return lock, nil
}

func writeLock(path string, lock LockFile) error {
	data, err := yaml.Marshal(lock)
	if err != nil {
		return fmt.Errorf("encode lock file: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write lock file: %w", err)
	}
	return nil
}

func fileHash(path string) (string, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), true, nil
}

func copyFile(source, target string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, data, 0o644)
}
