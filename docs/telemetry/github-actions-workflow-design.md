<!-- markdownlint-disable MD013 -->

# GitHub ActionsテレメトリWorkflow設計

作成日: 2026-06-17

## 目的

GitHub Actionsでは、GitHub API/GraphQLだけでは後から復元しづらい実行時証拠をJSON artifactとして保存する。PR、CI、merge前後の状態をentire checkpointと結合できるようにする。

## 既存workflowとの整合

このrepositoryの既存workflowは次の慣習を持つ。

| 慣習                            | 設計への反映                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| ファイル名は `00-*`             | telemetry workflowも `00-telemetry-*.yaml` にする                                                   |
| workflow名は `[00] ...`         | workflow nameも `[00] Telemetry ...` にする                                                         |
| `permissions` を明示            | 全workflowで最小権限を明示する                                                                      |
| actionsはSHA pin                | 実装時は例示YAML内のactionsもSHA pinに置き換える                                                    |
| `pull_request_target`は限定利用 | telemetryは原則 `pull_request`。PR本文更新のようなbase context処理だけ `pull_request_target` を使う |

## 共通設計

### Artifact形式

各workflowは1 runにつき1つ以上のJSON artifactを出す。

```text
telemetry/
  pr-event/<owner>_<repo>_pr-<number>_<event>_<head_sha>_<run_id>.json
  ci-result/<owner>_<repo>_run-<run_id>_attempt-<attempt>.json
  pre-merge/<owner>_<repo>_pr-<number>_<head_sha>_<run_id>.json
  post-merge/<owner>_<repo>_pr-<number>_<merge_commit_sha>_<run_id>.json
```

共通envelope。

```json
{
  "schema_version": "2026-06-17.1",
  "producer": "github-actions-telemetry",
  "snapshot_type": "pr_event",
  "generated_at": "2026-06-17T00:00:00Z",
  "repository": "owner/repo",
  "run": {
    "id": 123,
    "attempt": 1,
    "workflow": "[00] Telemetry PR snapshot",
    "job": "snapshot"
  },
  "payload": {}
}
```

### 保存と回収

| 項目          | 方針                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| Actions内保存 | `actions/upload-artifact` でJSONを保存する                                        |
| retention     | 最小30日。API syncが週次以上で回収する前提                                        |
| 永続化        | artifactをGitHub APIで回収し、DuckDB/Parquetへ保存する                            |
| 冪等性        | `snapshot_type + repo + pr_number + head_sha + run_id + run_attempt` でupsertする |
| 失敗時        | telemetry生成失敗は原則PRを落とさない。snapshot内に `collection_status` を残す    |

### Redaction

log excerptやtool output由来の文字列を保存する場合は、次を必ずredactする。

| 対象                | 例                                                    |
| ------------------- | ----------------------------------------------------- |
| GitHub token        | `ghp_`, `github_pat_`, `x-access-token:`              |
| cloud secret        | AWS/GCP/Azure tokenらしい文字列                       |
| private key         | `-----BEGIN ... PRIVATE KEY-----`                     |
| email               | 必要なければhash化                                    |
| local absolute path | `/Users/<name>/...` を `/Users/<redacted>/...` にする |

## Workflow 1: PR Event Snapshot

### PR Event Snapshotファイル

`.github/workflows/00-telemetry-pr-snapshot.yaml`

### PR Event Snapshot Trigger

```yaml
on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened, edited, closed]
```

### PR Event Snapshot Permissions

```yaml
permissions:
  contents: read
  pull-requests: read
  actions: read
```

### PR Event Snapshotで取得するものと理由

| 項目                     | 理由                                                             | 分析結果                                                             |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| event action/time        | PR lifecycleのステージを固定する                                 | openedからready_for_reviewまでの変化、synchronize回数を測れる        |
| head/base sha/ref        | branchが進んでもイベント時点を再現する                           | entire session、commit、CI resultを正確に結合できる                  |
| synchronize before/after | APIだけでは後から落ちたcommitを追いづらい                        | force push疑い、大きな履歴置換の影響を測れる                         |
| checkpoint ids           | existing `Entire-Checkpoint:` trailerとPR body sectionを結合する | OpenCode checkpointとPR outcomeを高信頼で結べる                      |
| diff stat/name-status    | event時点の変更規模を固定する                                    | PRが途中で膨らんだか、docs-onlyからcode changeに変わったかを見られる |
| path classifiers         | 分析用に変更種別を即時要約する                                   | workflow変更、test不足、lockfile変更などのriskを比較できる           |
| issue links/GitHub URLs  | PR本文の参照をイベント時点で残す                                 | issue起点作業、review起点作業、ad-hoc作業を分類できる                |

### PR Event Snapshot JSON payload例

```json
{
  "snapshot_type": "pr_event",
  "payload": {
    "event_action": "synchronize",
    "repository": "y-writings/example",
    "pr_number": 123,
    "pr_node_id": "PR_kw...",
    "head_ref": "feature/example",
    "base_ref": "main",
    "head_sha": "abc123",
    "base_sha": "def456",
    "synchronize_before": "oldsha",
    "synchronize_after": "abc123",
    "is_draft": false,
    "title_semantic": {
      "type": "feat",
      "scope": "telemetry",
      "subject": "collect pr snapshots"
    },
    "body_summary": {
      "hash": "sha256:...",
      "length": 1200,
      "linked_issues": [45],
      "github_urls": ["https://github.com/y-writings/example/issues/45"]
    },
    "entire_checkpoint_ids": ["8e99bd49ded6"],
    "diff": {
      "changed_files": 4,
      "additions": 98,
      "deletions": 103,
      "name_status": ["M .github/workflows/ci.yaml"]
    },
    "classifiers": {
      "docs_only": false,
      "touches_workflow": true,
      "touches_tests": true,
      "touches_lockfile": false,
      "touches_secrets_or_permissions": true
    }
  }
}
```

### PR Event Snapshot実装スケルトン

以下は構造を示すための例。既存workflowで確認できるactionは同じSHA pinを記載する。`actions/upload-artifact@v4` は設計例としてtag表記にしているため、実装時は対応するcommit SHAへ固定する。

```yaml
name: "[00] Telemetry PR snapshot"

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened, edited, closed]

permissions:
  contents: read
  pull-requests: read
  actions: read

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - name: Check out pull request for diff inspection
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Build PR telemetry snapshot
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        with:
          script: |
            // 1. Read context.payload.pull_request
            // 2. Extract head/base refs and synchronize before/after if present
            // 3. Fetch commits and parse Entire-Checkpoint trailers
            // 4. Run safe git diff commands or use API file list
            // 5. Write telemetry/pr-event/*.json

      - name: Upload telemetry artifact
        uses: actions/upload-artifact@v4
        with:
          name: telemetry-pr-event-${{ github.event.pull_request.number }}-${{ github.run_id }}-${{ github.run_attempt }}
          path: telemetry/pr-event/*.json
          retention-days: 30
```

## Workflow 2: CI Result Collector

### CI Result Collectorファイル

`.github/workflows/00-telemetry-ci-result-collector.yaml`

### CI Result Collector Trigger

```yaml
on:
  workflow_run:
    types: [completed]
```

collector自身を対象外にする。対象workflowはallowlistで制御する。

```yaml
env:
  TELEMETRY_CI_WORKFLOW_ALLOWLIST: "CI,Test,Build,Security scan"
```

### CI Result Collector Permissions

```yaml
permissions:
  contents: read
  actions: read
  pull-requests: read
```

### CI Result Collectorで取得するものと理由

| 項目                    | 理由                             | 分析結果                                           |
| ----------------------- | -------------------------------- | -------------------------------------------------- |
| workflow/job conclusion | CIの成功/失敗をjob粒度で見る     | 失敗しやすいjob、flake疑いを抽出できる             |
| duration                | CI待ち時間とコストを見る         | 遅いworkflowの改善優先度を決められる               |
| failed step             | ログ全文なしで失敗箇所を残す     | 同じstepが繰り返し壊れているか分かる               |
| failure signature       | 似た失敗をgroup化する            | skill化や自動診断の対象を選べる                    |
| redacted log excerpt    | 失敗理由の最小証拠を保持する     | APIログ期限切れ後も分類を再確認できる              |
| test summary / coverage | runner生成物が消える前に要約する | test不足やcoverage低下とreview指摘の関係を見られる |

### Failure signature方針

| 入力                  | 正規化                                              |
| --------------------- | --------------------------------------------------- |
| failed step名         | そのまま保存                                        |
| error line            | file path、line number、duration、random idを一般化 |
| stack trace           | 上位数行を抽出し、hash化                            |
| test failure          | test suite、test name、assertion typeを抽出         |
| package manager error | error code、package name、commandを抽出             |

### CI Result Collector JSON payload例

```json
{
  "snapshot_type": "ci_result",
  "payload": {
    "source_run_id": 456,
    "source_run_attempt": 2,
    "workflow_name": "CI",
    "head_sha": "abc123",
    "pull_requests": [{ "number": 123 }],
    "jobs": [
      {
        "job_id": 789,
        "job_name": "test",
        "conclusion": "failure",
        "duration_ms": 185000,
        "failed_step_name": "Run tests",
        "failure_signature": "pytest:tests/test_example.py::test_foo:AssertionError",
        "log_excerpt_redacted": "AssertionError: expected ...",
        "test_summary": {
          "total": 120,
          "failed": 1,
          "skipped": 3,
          "failed_tests": ["tests/test_example.py::test_foo"]
        }
      }
    ]
  }
}
```

### CI Result Collector実装スケルトン

```yaml
name: "[00] Telemetry CI result collector"

on:
  workflow_run:
    types: [completed]

permissions:
  contents: read
  actions: read
  pull-requests: read

jobs:
  collect:
    if: ${{ github.event.workflow_run.name != '[00] Telemetry CI result collector' }}
    runs-on: ubuntu-latest
    steps:
      - name: Build CI result telemetry snapshot
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        with:
          script: |
            // 1. Inspect context.payload.workflow_run
            // 2. Skip non-allowlisted workflows
            // 3. List jobs for run_attempt
            // 4. Download logs for failed jobs while available
            // 5. Redact and extract failure signatures
            // 6. Write telemetry/ci-result/*.json

      - name: Upload telemetry artifact
        uses: actions/upload-artifact@v4
        with:
          name: telemetry-ci-result-${{ github.event.workflow_run.id }}-${{ github.event.workflow_run.run_attempt }}
          path: telemetry/ci-result/*.json
          retention-days: 30
```

## Workflow 3: Pre-Merge Snapshot

### Pre-Merge Snapshotファイル

`.github/workflows/00-telemetry-pre-merge-snapshot.yaml`

### Trigger候補

通常PR運用なら、PRイベントで最新状態を繰り返し保存する。

```yaml
on:
  pull_request:
    types: [ready_for_review, synchronize, reopened, edited]
```

厳密にmerge直前の状態が必要なら、branch protectionのrequired checkまたはmerge queueの`merge_group`に入れる。

```yaml
on:
  merge_group:
  pull_request:
    types: [ready_for_review, synchronize, reopened]
```

### Pre-Merge Snapshot Permissions

```yaml
permissions:
  contents: read
  pull-requests: read
  checks: read
  statuses: read
```

### Pre-Merge Snapshotで取得するものと理由

| 項目                       | 理由                        | 分析結果                                   |
| -------------------------- | --------------------------- | ------------------------------------------ |
| head sha / base sha        | snapshot対象を固定する      | post-mergeやCI resultと結合できる          |
| required checks            | merge gateの状態を記録する  | どのcheckがmerge待ちを生んだか分かる       |
| latest successful CI       | greenになった時刻を固定する | greenからmergeまでの待ち時間を測れる       |
| approvals/change requested | review gateの状態を要約する | review状態とmerge結果の関係を見られる      |
| unresolved thread count    | review残課題を測る          | 未解決thread mergeやreview負債を検出できる |
| commit/push count          | 修正ループ量を測る          | push回数とCI/review負荷の関係を見られる    |

### 運用判断

| 運用                        | 推奨                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| 最初の導入                  | required checkにしない。artifact生成だけで始める                         |
| 欠落なくpre-merge状態が必要 | required check化する。ただしtelemetry収集失敗でmergeを止めない設計にする |
| merge queue利用repo         | `merge_group` snapshotを追加する                                         |

### Pre-Merge Snapshot実装スケルトン

```yaml
name: "[00] Telemetry pre-merge snapshot"

on:
  pull_request:
    types: [ready_for_review, synchronize, reopened, edited]
  merge_group:

permissions:
  contents: read
  pull-requests: read
  checks: read
  statuses: read

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - name: Build pre-merge telemetry snapshot
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        with:
          script: |
            // 1. Resolve PR from pull_request or merge_group context
            // 2. Query reviews and review threads
            // 3. Query checks/statuses for head sha
            // 4. Count commits and event-time push/synchronize history
            // 5. Write telemetry/pre-merge/*.json

      - name: Upload telemetry artifact
        uses: actions/upload-artifact@v4
        with:
          name: telemetry-pre-merge-${{ github.run_id }}-${{ github.run_attempt }}
          path: telemetry/pre-merge/*.json
          retention-days: 30
```

## Workflow 4: Post-Merge Snapshot

### Post-Merge Snapshotファイル

`.github/workflows/00-telemetry-post-merge-snapshot.yaml`

### Post-Merge Snapshot Trigger

```yaml
on:
  pull_request:
    types: [closed]
```

jobはmerged PRだけで実行する。

```yaml
if: ${{ github.event.pull_request.merged == true }}
```

### Post-Merge Snapshot Permissions

```yaml
permissions:
  contents: read
  pull-requests: read
  actions: read
```

### Post-Merge Snapshotで取得するものと理由

| 項目                         | 理由                  | 分析結果                                             |
| ---------------------------- | --------------------- | ---------------------------------------------------- |
| merged_at / merge_commit_sha | PR完了の固定点        | follow-up、revert、default branch CIと結合できる     |
| final head sha               | merge直前のheadを固定 | session、commit、CI resultとのend-to-end結合ができる |
| time to merge                | 成果指標になる        | task type別・開発スタイル別の速度比較ができる        |
| final diff stats             | 最終規模を固定        | PR途中膨張や大規模PRのreview負荷を測れる             |
| review/thread summary        | review負荷を要約      | review reworkの量をPR単位で比較できる                |
| CI failure/rerun summary     | CI負荷を要約          | CI-repair作業の有効性を測れる                        |
| default branch CI run link   | merge後破壊の起点     | merge後失敗、revert、follow-up PRの検出に使える      |

### Post-Merge Snapshot実装スケルトン

```yaml
name: "[00] Telemetry post-merge snapshot"

on:
  pull_request:
    types: [closed]

permissions:
  contents: read
  pull-requests: read
  actions: read

jobs:
  snapshot:
    if: ${{ github.event.pull_request.merged == true }}
    runs-on: ubuntu-latest
    steps:
      - name: Build post-merge telemetry snapshot
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        with:
          script: |
            // 1. Read merged pull_request payload
            // 2. Query final PR files, reviews, threads, check runs
            // 3. Compute final summary and time_to_merge
            // 4. Write telemetry/post-merge/*.json

      - name: Upload telemetry artifact
        uses: actions/upload-artifact@v4
        with:
          name: telemetry-post-merge-${{ github.event.pull_request.number }}-${{ github.run_id }}-${{ github.run_attempt }}
          path: telemetry/post-merge/*.json
          retention-days: 30
```

## API同期側の回収設計

Actions artifactは保持期限があるため、GitHub API同期ジョブが定期的に回収する。

| 処理             | 内容                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| workflow run列挙 | `repo`, workflow name prefix `[00] Telemetry` で検索                                 |
| artifact列挙     | `telemetry-*` artifactだけ対象にする                                                 |
| download         | zipを展開しJSON schemaを検証する                                                     |
| upsert           | `snapshot_type`, `repo`, `pr_number`, `head_sha`, `run_id`, `run_attempt` で冪等登録 |
| retention監視    | 最古未回収artifactが保持期限に近づいたら警告する                                     |
| schema drift検出 | `schema_version` ごとにparserを分け、未知fieldを隔離する                             |

## pull_request_targetの扱い

既存の `.github/workflows/00-entire-checkpoint-collection.yaml` はPR本文を書き換えるために `pull_request_target` を使っている。このworkflowはhead checkoutをしておらず、commit messageをAPIで読むだけなので用途が限定されている。

telemetry workflowでは原則 `pull_request` を使う。理由は次の通り。

| 理由             | 説明                                                              |
| ---------------- | ----------------------------------------------------------------- |
| untrusted PR対策 | fork PRのコードを高権限contextで扱わない                          |
| 書き込み不要     | telemetry artifact uploadはPR本文更新を必要としない               |
| 権限最小化       | `contents: read`, `pull-requests: read`, `actions: read` で足りる |

## 初期実装の推奨範囲

最初は全workflowを一度に入れず、欠落リスクが低い順に導入する。

| フェーズ | 追加workflow        | 理由                                                        |
| -------- | ------------------- | ----------------------------------------------------------- |
| 1        | PR Event Snapshot   | checkpoint/PR/branch/head_shaの結合を検証するための最小単位 |
| 2        | CI Result Collector | ログ保持期限で失われる価値が高い                            |
| 3        | Post-Merge Snapshot | PR単位の成果指標を固定できる                                |
| 4        | Pre-Merge Snapshot  | required check化の運用判断が必要なため後回し                |

## 成功条件

| 条件                                     | 確認方法                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| 1 PRにつきPR Event Snapshotが生成される  | Actions artifactにJSONが保存される                                              |
| `checkpoint_id` でentireとPRが結合できる | `Entire-Checkpoint:` trailerまたはPR body sectionからlinkが作れる               |
| CI失敗がsignature化される                | 同じ失敗が同じ `failure_signature` にまとまる                                   |
| artifactが期限前に回収される             | DuckDB/Parquet側に `gha_*` tableが作られる                                      |
| 分析martが作れる                         | PR単位でsession数、tool call数、CI失敗数、review comment数、time to mergeが出る |
