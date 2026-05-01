# Template Sync Design

このリポジトリは、開発リポジトリへ共通のベースライン設定を配布するためのテンプレートリポジトリとして扱う。

対象には、GitHub Actions workflow、commitlint、lefthook、pinact などの共通設定を含める。一方で、配布先リポジトリごとのタスクや環境変数が自然に増える設定は、単純なファイル上書きではなく、テンプレート管理部分とローカル管理部分を分ける。

## Goals

- 配布先リポジトリが、このテンプレートリポジトリと同期できているか確認できる。
- テンプレート側の変更を、配布先リポジトリへ安全に反映できる。
- 配布先で意図的に追加した設定を、テンプレート更新で壊しにくくする。
- テンプレートから削除されたファイルを、事故なく段階的に廃止できる。

## Recommended Approach

基本方針は、マニフェスト駆動のファイル単位同期とする。

テンプレートリポジトリには、配布対象を定義するマニフェストを置く。

```yaml
# templates.yaml
version: 1
templates:
  - id: github-workflow-scan
    source: .github/workflows/scan.yaml
    target: .github/workflows/scan.yaml
  - id: github-workflow-semantic-pr
    source: .github/workflows/semantic-pr.yaml
    target: .github/workflows/semantic-pr.yaml
  - id: commitlint
    source: .commitlintrc.yaml
    target: .commitlintrc.yaml
  - id: lefthook
    source: lefthook.yaml
    target: lefthook.yaml
  - id: pinact
    source: .pinact.yaml
    target: .pinact.yaml
```

配布先リポジトリには、同期済みの状態を記録する lock file を置く。

```yaml
# .template-sync.lock
repository: y-writings/templates
ref: v2026.05.01
files:
  github-workflow-scan:
    target: .github/workflows/scan.yaml
    source_sha256: abc123
  github-workflow-semantic-pr:
    target: .github/workflows/semantic-pr.yaml
    source_sha256: def456
```

同期スクリプトは、マニフェストと lock file を見て、追加、更新、差分、削除候補を判定する。

想定するコマンドは次の通り。

```sh
template-sync check
template-sync diff
template-sync update
template-sync prune
```

## File-Level Sync

GitHub Actions workflow や commitlint などは、基本的にファイル全体を標準化したい設定である。そのため、まずはファイル単位で同期する。

対象例:

- `.github/workflows/scan.yaml`
- `.github/workflows/semantic-pr.yaml`
- `.commitlintrc.yaml`
- `lefthook.yaml`
- `.pinact.yaml`

ファイル単位同期では、配布先の対象ファイルをテンプレート側の内容と比較する。差分がある場合は `check` または `diff` で検出し、`update` で反映する。

ファイル内の一部だけを同期するブロック単位同期は、初期段階では採用しない。YAML や TOML の構造、インデント、コメント、ローカル変更との衝突を扱う必要があり、運用と実装が複雑になりやすいため。

## mise.toml

`mise.toml` は、配布先リポジトリごとのタスクや環境変数が追加されやすい。そのため、ファイル全体同期の対象にはしない。

推奨は、テンプレート管理部分とローカル管理部分を分ける構成である。

```text
mise.toml
.mise/template.toml
.mise/local.toml
```

- `mise.toml`: 配布先リポジトリが持つ入口。
- `.mise/template.toml`: このテンプレートリポジトリから同期する共通設定。
- `.mise/local.toml`: 配布先リポジトリ固有の設定。同期対象外。

例:

```toml
# .mise/template.toml

[settings]
experimental = true

[hooks]
enter = "if [ -f lefthook.yaml ]; then lefthook install; fi"

[env]
GH_CONFIG_DIR = "{{config_root}}/.gh"

[tasks.pin]
description = "Pin repository references with pinact and dockerfile-pin"
run = ["pinact run --check --fix", "dockerfile-pin run --write"]

[tasks.scan]
description = "Scan all repository files with betterleaks"
run = ["betterleaks dir --no-banner --redact=20 ."]
```

配布先は `.mise/local.toml` にリポジトリ固有のタスクを追加する。

```toml
# .mise/local.toml

[env]
PROJECT_NAME = "my-service"

[tasks.test]
run = "go test ./..."

[tasks.dev]
run = "docker compose up"
```

実際に採用する include の記法は、導入時点の mise の仕様に合わせて確認する。

## Deletion Policy

ファイル削除は、追加や更新より影響が大きいため、即時削除しない。

マニフェストと lock file の差分から、次のように判定する。

- マニフェストにあり、lock file にないもの: 新規追加候補。
- マニフェストにも lock file にもあるもの: 通常の同期対象。
- マニフェストから消えたが lock file に残っているもの: 削除候補。
- lock file にもなく、配布先だけにあるもの: ユーザー管理ファイルとして無視。

削除候補は `update` では削除しない。`update` は追加と更新を扱い、削除は明示的な `prune` で行う。

```sh
template-sync update
template-sync prune
```

`prune` では、対象ファイルがテンプレート由来のままかを確認する。

- lock file の `source_sha256` と現在のファイル hash が一致する場合、削除可能。
- hash が一致しない場合、配布先で変更されているため削除せず conflict とする。

これにより、テンプレート側で廃止した workflow や設定ファイルを安全に削除候補として扱える。

## Phased Rollout

### Phase 1: Local Script

まずはローカルで実行できる同期スクリプトを用意する。

- `check`: 同期状態を検査する。
- `diff`: テンプレートとの差分を表示する。
- `update`: 追加と更新を反映する。
- `prune`: 削除候補を明示的に削除する。

### Phase 2: Drift Detection

配布先リポジトリの GitHub Actions で定期的に `check` を実行し、テンプレートとの差分を検出する。

CI では、運用方針に応じて warning または fail を選べるようにする。

### Phase 3: Automated Pull Requests

`template-sync update` を GitHub Actions 上で実行し、差分があれば自動で pull request を作成する。

この段階では、削除は `prune` を明示した場合だけ行う。自動 PR でも削除候補を本文に表示し、必要に応じて別 PR として扱う。

## Summary

このリポジトリでは、まず次の設計で進める。

- 通常の共通設定は `templates.yaml` と `.template-sync.lock` によるファイル単位同期にする。
- `mise.toml` はファイル全体同期せず、テンプレート管理部分とローカル管理部分を分ける。
- ファイル削除は `update` では行わず、削除候補として検出した上で `prune` に分離する。
- lock file に記録があるファイルだけを削除候補にし、配布先で変更済みなら削除しない。
