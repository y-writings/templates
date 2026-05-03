# templates

共通の開発ベースライン設定を、複数のリポジトリへ安全に配布するためのテンプレートリポジトリです。

このリポジトリの `templates.yaml` を source of truth として、GitHub Actions、commitlint、lefthook、pinact、mise、Entire などの設定ファイルを配布先リポジトリへ同期します。同期には Go 製 CLI `template-sync` を使います。

## What is included

現在 `templates.yaml` で管理しているテンプレートは次の通りです。

| ID | Source | Target | Notes |
| --- | --- | --- | --- |
| `github-workflow-scan` | `.github/workflows/scan.yaml` | `.github/workflows/scan.yaml` | Betterleaks scan workflow |
| `github-workflow-semantic-pr` | `.github/workflows/semantic-pr.yaml` | `.github/workflows/semantic-pr.yaml` | Semantic PR title workflow |
| `commitlint` | `.commitlintrc.yaml` | `.commitlintrc.yaml` | Commit message rules |
| `lefthook` | `lefthook.yaml` | `lefthook.yaml` | Git hooks for scan and commitlint |
| `pinact` | `.pinact.yaml` | `.pinact.yaml` | Pinning rules |
| `mise-baseline` | `.mise/config.baseline.toml` | `.mise/config.baseline.toml` | Shared mise tasks/env |
| `mise-project` | `.mise/config.toml` | `.mise/config.toml` | Created only when missing (`if_not_exists: true`) |
| `mise-rc` | `.miserc.toml` | `.miserc.toml` | mise activation config |
| `LICENSE` | `LICENSE` | `LICENSE` | Shared license file |
| `entire-gitignore` | `.entire/.gitignore` | `.entire/.gitignore` | Entire ignore rules |
| `entire-settings-json` | `.entire/settings.json` | `.entire/settings.json` | Entire shared settings |

`template-sync update` also ensures the configured `.gitignore` entries exist in the target repository. The current manifest adds `.gh`.

## Requirements

- Go `1.22` or newer
- This repository pins Go `1.22.12` in `.mise/config.toml`
- `git` for `template-sync diff` (`git diff --no-index` is used internally)

## Quick start

From this repository:

```sh
go run ./src/cmd/template-sync -- help
go run ./src/cmd/template-sync -- check
```

From a target repository, point the CLI at a checkout of this template repository:

```sh
go run ../templates/src/cmd/template-sync -- check \
  --template-dir ../templates \
  --target-dir .

go run ../templates/src/cmd/template-sync -- update \
  --template-dir ../templates \
  --target-dir . \
  --repository y-writings/templates \
  --ref v2026.05.01
```

To build a local binary:

```sh
go build -o bin/template-sync ./src/cmd/template-sync
bin/template-sync help
```

## CLI usage

```text
usage: template-sync <command> [options]

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
  --ref string           ref value written to lock file
```

`template-sync -- help` is also accepted, which is useful when passing arguments through another tool such as `go run`.

## How synchronization works

`template-sync` is a file-level synchronizer. It does not render template variables or merge partial YAML/TOML blocks. Source files are copied byte-for-byte, and file hashes are recorded in a lock file.

The lock file defaults to `.template-sync.lock` and records:

```yaml
repository: y-writings/templates
ref: v2026.05.01
files:
  github-workflow-scan:
    target: .github/workflows/scan.yaml
    source_sha256: ...
```

Status values:

| Status | Meaning |
| --- | --- |
| `synced` | Target matches the template, or an existing `if_not_exists` target is intentionally preserved. |
| `add` | Target file is missing and can be copied from the template. |
| `update` | Target file exists but differs from the template. |
| `prune` | File exists in the lock file but was removed from the manifest, and is unchanged locally. |
| `conflict` | File was removed from the manifest but has local changes in the target repository. |

`update` applies `add` and `update` changes, refreshes the lock file, and appends configured `.gitignore` entries. It does not delete stale files. Use `prune` explicitly to remove files that were deleted from the manifest.

For safety, manifest paths and lock targets must be relative paths inside their configured roots. Absolute paths and `..` escapes are rejected.

## Manifest format

`templates.yaml` uses schema version `1` and is validated by `templates.schema.json`.

```yaml
# yaml-language-server: $schema=./templates.schema.json
version: 1
$schema: ./templates.schema.json

templates:
  - id: commitlint
    source: .commitlintrc.yaml
    target: .commitlintrc.yaml
  - id: mise-project
    source: .mise/config.toml
    target: .mise/config.toml
    if_not_exists: true

gitignore:
  - .gh
```

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `version` | yes | Manifest schema version. Must be `1`. |
| `$schema` | no | Schema marker for YAML tooling. |
| `templates[].id` | yes | Logical template identifier. Must be unique. |
| `templates[].source` | yes | Source file path inside the template repository. |
| `templates[].target` | yes | Destination file path inside the target repository. |
| `templates[].if_not_exists` | no | Preserve an existing target file instead of overwriting it. |
| `gitignore[]` | no | Entries to append to the target repository `.gitignore`. |

Placeholders such as `${{ secrets.GITHUB_TOKEN }}`, `{{config_root}}`, or `{1}` belong to the tools inside the synced files (GitHub Actions, mise, lefthook, etc.). They are not interpreted by `template-sync`.

## Development

Install the pinned tools with mise if you use it:

```sh
mise install
mise run baseline:setup
```

Run the Go tests:

```sh
go test ./...
```

Run the release-tag helper tests:

```sh
bash scripts/test-derive-release-tag.sh
```

Useful local commands:

```sh
go run ./src/cmd/template-sync -- check
go run ./src/cmd/template-sync -- diff
go run ./src/cmd/template-sync -- update --repository y-writings/templates --ref v2026.05.01
mise run baseline:pin
mise run baseline:scan
```

## Maintainer operations

This repository also contains automation for weekly snapshot tags and generated changelog pull requests.

- Snapshot tags use the `vYYYY.MM.DD` format and are driven by `.github/workflows/release-tag.yml`.
- `CHANGELOG.md` is generated by `git-cliff` through `.github/workflows/changelog.yml`.
- Repository setup details are documented in [`docs/github-settings.md`](docs/github-settings.md).
- The design background for the synchronizer is documented in [`docs/template-sync.md`](docs/template-sync.md). The current implementation and `templates.yaml` are the source of truth when they differ from older design examples.

The snapshot helper can also be exercised locally:

```sh
SNAPSHOT_DATE=2026.05.01 bash scripts/derive-release-tag.sh
```
