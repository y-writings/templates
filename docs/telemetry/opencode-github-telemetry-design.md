<!-- markdownlint-disable MD013 -->

# OpenCodeログとGitHubテレメトリ横断分析設計

作成日: 2026-06-17

## 目的

Entire CLIで収集しているOpenCodeログと、GitHub上のPull Request、review、CI、merge結果を結合し、開発プロセスを横断分析できる状態にする。

この設計で重視する問いは次の4つ。

| 問い                                     | 例                                                                   | 期待する施策                                    |
| ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| トイルはどこにあるか                     | 同じCIログ確認、同じtest再実行、同じreview修正が繰り返されていないか | skill、repo context、事前チェック、CI失敗分類器 |
| 成功する開発セッションの型は何か         | 初回prompt、探索順、tool call、テスト実行がreview/CI結果にどう効くか | task type別の推奨進行パターン                   |
| どの前兆がreview修正やCI失敗につながるか | 大量read、未検証報告、workflow権限変更、lockfile変更など             | PR作成前チェック、ガードレール                  |
| task typeごとに良い開発スタイルは何か    | Spec-first、TDD、Review-driven、CI-repairのどれが有効か              | repo別・作業種別別のplaybook                    |

## 参照した入力

| 入力                                                                                | 確認内容                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Obsidianノート `OpenCodeログ分析とGitHubテレメトリ設計`                             | GitHub APIはPR/review/CIの事実補完、Actionsは後から再現しにくい実行時証拠に限定する方針        |
| `/Users/neo/workspace/repos/github.com/y-writings/templates/.wt/entire-checkpoint/` | `metadata.json`, `full.jsonl`, `prompt.txt`, `content_hash.txt` からなるcheckpoint/session構造 |
| 既存workflow                                                                        | `00-*` 命名、明示permissions、SHA pin、`pull_request_target`はPR本文更新など限定用途で使用     |

## 前提

| 前提                                                                                             | 設計への影響                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| entireのsource of truthは現在のGit管理されたcheckpoint repository                                | GitHub側はentireログを再保存せず、結合キーとGitHub事実だけを集める                   |
| `full.jsonl` は名前に反してJSON object                                                           | 取り込みではJSONL parserではなくJSON parserを使う                                    |
| session metadataには `session_id`, `checkpoint_id`, `created_at`, `branch`, `token_usage` がある | session単位でGitHub PR、branch、commitと結合できる                                   |
| transcriptには `info.directory`, `info.summary`, message、tool call、patch、promptがある         | repo推定、作業量、探索順、検証回数を抽出できる                                       |
| GitHub API/GraphQLで後から取れる情報は多い                                                       | Actionsで完全コピーせず、API同期で取得する                                           |
| Actionsログと一部runner上の成果物は保持期限や再現性に制約がある                                  | 失敗step、failure signature、test summary、coverageなどはActionsで構造化して保存する |
| マージ直前状態は通常のPR APIだけでは厳密に復元しづらい                                           | 必要ならpre-merge snapshotをrequired checkまたはmerge queueに組み込む                |

## 採用方針

採用するのは、GitHub APIを事実系、GitHub Actionsを実行時証拠に限定するハイブリッド方式。

| 案                  | 内容                                                                    | 長所                       | 短所                                                             | 判断   |
| ------------------- | ----------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- | ------ |
| API中心             | PR、review、checks、files、timelineを後からAPI同期する                  | 重複が少なく実装が簡単     | CI失敗ログ、runner上のtest summary、マージ直前状態が欠落しやすい | 不採用 |
| Actions全面snapshot | PRイベントごとにPR本文、review、checks、files、logsを全部artifact化する | イベント時点の再現性が高い | データ量、重複、権限、機微情報の扱いが重い                       | 不採用 |
| ハイブリッド        | APIで耐久的なGitHub事実を取得し、Actionsは後から取りにくい証拠だけ残す  | 重複を抑えつつ欠落を補える | API同期とartifact回収の2経路が必要                               | 採用   |

## 取得元の責務

| 取得元                  | 責務                                            | 代表データ                                                                                     | 取得しないもの                                              |
| ----------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| entire checkpoint       | AI開発セッションの実行ログ                      | prompt、message、tool call、patch、token、checkpoint、files_touched                            | GitHubの最終状態                                            |
| GitHub API/GraphQL      | GitHub上に残る耐久的な事実                      | PR、review、review thread、commits、files、checks、timeline、issues                            | Actionsログ本文の完全保存、runner上で生成された一時ファイル |
| GitHub Actions artifact | APIで後から再現しづらいイベント時点・実行時証拠 | PR event snapshot、CI failure signature、test summary、pre-merge snapshot、post-merge snapshot | PR/review/commentの完全コピー                               |

## GitHub APIから取得するもの

GitHub API/GraphQL同期は、日次または手動で過去分を再取得できる前提にする。保存先はDuckDB/Parquetに正規化する。

| 領域                    | 取得項目                                                                                                                                                                                                      | 理由                                                                 | 解析でできること                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pull Request            | `number`, `node_id`, `createdAt`, `updatedAt`, `closedAt`, `mergedAt`, `isDraft`, `baseRefName`, `headRefName`, `headRefOid`, `baseRefOid`, `mergeCommit`, `additions`, `deletions`, `changedFiles`, `labels` | PRのライフサイクルと規模はGitHub上の耐久的事実で、後から取得しやすい | time to merge、規模とreview/CI失敗の関係、task type推定                                              |
| Reviews                 | reviewer、state、submittedAt、body length、commit oid                                                                                                                                                         | review開始までの時間、承認/差戻しの発生を追うため                    | AI sessionの作業量とreview負荷の相関、review-driven作業の効果測定                                    |
| Review threads/comments | thread id、resolved状態、path、line、author、createdAt、updatedAt、reply count                                                                                                                                | 指摘の量と解消状態は品質フィードバックの主要信号                     | 繰り返し指摘、未解決のままmergeされたリスク、path別の弱点                                            |
| Commits                 | oid、authored/committed date、message、parents、associated PR                                                                                                                                                 | checkpoint trailer、push回数、修正の粒度を見るため                   | checkpoint_idとの結合、review後修正回数、Actionsの`synchronize before/after`と合わせた履歴変化の検出 |
| Check suites/runs       | workflow name、job/check name、status、conclusion、started/completed、run id、attempt、details URL                                                                                                            | CIの最終結果と所要時間はAPIで取れる                                  | CI失敗回数、rerun回数、遅いworkflow、品質ゲートとの関係                                              |
| Files                   | path、additions、deletions、status、previous filename                                                                                                                                                         | 変更対象とreview/CI結果を結びつけるため                              | docs-only、test有無、workflow変更、言語別リスク分析                                                  |
| Issues/linked issues    | closing issue、linked issue、labels、milestone                                                                                                                                                                | 作業要求の種類や背景を推定するため                                   | issue種別別の開発スタイル、仕様不明瞭さとreview負荷の関係                                            |
| Timeline events         | ready_for_review、review_requested、labeled、unlabeled、committed、merged、closed                                                                                                                             | PR内の順序と待ち時間を復元するため                                   | draft期間、review待ち、修正ループ、mergeまでのボトルネック分析                                       |

## GitHub Actionsから取得するもの

Actionsは「全部を集める場所」ではなく、API同期だけでは弱い証拠を補完する場所にする。

| Snapshot            | Trigger                                                            | 取得するもの                                                                                                        | Actionsで取る理由                                                      | 解析でできること                                                       |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| PR Event Snapshot   | `pull_request` opened/synchronize/ready_for_review/reopened/closed | event action、run id、head/base sha、branch、draft、diff分類、checkpoint ids、issue links、synchronize before/after | イベント時点のhead/baseやPR本文由来のリンクは後で変わることがある      | OpenCode sessionとPR版の結合、作業ステージ別の変化、force push疑い検出 |
| CI Result Snapshot  | `workflow_run` completed                                           | workflow/job/step conclusion、duration、failed step、failure signature、test summary、coverage、log excerpt digest  | Actionsログとrunner上のtest resultは保持期限があり、後から失われやすい | CI-repair型作業の効果、同じ失敗の反復、失敗分類別の修正コスト          |
| Pre-Merge Snapshot  | required checkまたは`merge_group`                                  | unresolved threads、approval数、required checks、latest successful CI、commit/push count、head sha                  | mergeボタン直前に近い状態は後から厳密復元しにくい                      | merge前の品質ゲート状態、review未解決リスク、merge queue内の失敗傾向   |
| Post-Merge Snapshot | `pull_request` closed and merged                                   | final head sha、merge commit、time to merge、final diff分類、CI失敗回数、rerun回数、default branch CI link          | merge完了時点を区切りイベントとして固定する                            | PR単位の成果測定、follow-up/revert検出の起点、開発スタイル比較         |

## データフロー

```text
entire checkpoint repository
  -> Python normalizer
  -> opencode_* tables / Parquet

GitHub API / GraphQL
  -> GitHub sync job
  -> github_* tables / Parquet

GitHub Actions artifacts
  -> artifact download by run_id before retention expiry
  -> gha_* tables / Parquet

opencode_* + github_* + gha_*
  -> DuckDB marts
  -> toil, quality, CI, review, development-style analysis
```

## entire側で正規化するテーブル

| テーブル               | 粒度               | 主キー候補                    | 主要フィールド                                                                      |
| ---------------------- | ------------------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| `opencode_checkpoints` | checkpoint         | `checkpoint_id`               | branch、strategy、files_touched、session_count、token_usage合計                     |
| `opencode_sessions`    | session            | `session_id`                  | checkpoint_id、created_at、repo、branch、model、agent、turn_count、token_usage      |
| `opencode_prompts`     | prompt             | `session_id`, `prompt_index`  | prompt text、GitHub URL、PR/comment/run id抽出結果                                  |
| `opencode_messages`    | message            | `session_id`, `message_index` | role、created/updated、token、duration、finish reason                               |
| `opencode_tool_calls`  | tool call          | `session_id`, `call_id`       | tool、input summary、status、exit code、duration、output digest、GitHub URL抽出結果 |
| `opencode_patches`     | patch/edit         | `session_id`, `patch_index`   | file path、operation、additions/deletions、timestamp                                |
| `opencode_attribution` | checkpoint/session | `checkpoint_id`, `session_id` | agent lines、human lines、agent percentage                                          |

## 結合キー設計

結合は単一キーに依存せず、信頼度を持つlink tableで管理する。

| 信頼度 | 結合キー                       | 使い方                                                                                                 | 注意点                                                                       |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| high   | `checkpoint_id`                | commit message trailer `Entire-Checkpoint: <id>`、PR bodyのEntire checkpoints section、entire metadata | 最も強い。既存 `00-entire-checkpoint-collection.yaml` がPR本文に反映している |
| high   | GitHub URL                     | prompt/tool output内のPR URL、review discussion URL、Actions run URL                                   | URL抽出後にowner/repo/number/idへ正規化する                                  |
| high   | `repo + head_sha`              | Actions snapshot、GitHub API、commit oid                                                               | session内でcommit shaが明示される場合に強い                                  |
| medium | `repo + branch + time window`  | entire `branch` とPR `headRefName`、session時刻とPR更新時刻                                            | branch名は再利用されるため単独では使わない                                   |
| medium | `repo + files_touched overlap` | entire files_touched とPR files                                                                        | 同名ファイル変更が多いrepoでは補助情報に留める                               |
| low    | `branch` only                  | 初期探索用                                                                                             | branch単独で確定結合しない                                                   |

link table例。

| フィールド      | 内容                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| `link_id`       | link record id                                                                       |
| `source_type`   | `prompt_url`, `tool_output_url`, `checkpoint_trailer`, `branch_time`, `file_overlap` |
| `session_id`    | entire session id                                                                    |
| `checkpoint_id` | entire checkpoint id                                                                 |
| `repo`          | `owner/repo`                                                                         |
| `pr_number`     | PR number                                                                            |
| `commit_sha`    | commit sha                                                                           |
| `confidence`    | `high`, `medium`, `low`                                                              |
| `evidence`      | URL、trailer、time windowなどの根拠                                                  |

## 分析mart

| mart                     | 粒度                  | 目的                       | 代表指標                                                                       |
| ------------------------ | --------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `mart_pr_development`    | PR                    | PRの開発全体を俯瞰する     | linked sessions、token、tool call、CI failures、review comments、time to merge |
| `mart_session_outcome`   | session               | session単位の成果を見る    | first patch time、verification count、failed tools、linked PR outcome          |
| `mart_ci_repair`         | CI failure group      | CI失敗から修正までを追う   | failure signature、repair session、time to green、rerun count                  |
| `mart_review_rework`     | review thread/comment | review指摘と修正作業を追う | comment category、path、repair commits、resolved time                          |
| `mart_toil_patterns`     | repeated pattern      | 繰り返し作業を発見する     | repeated command sequence、same failure signature、same review category        |
| `mart_development_style` | PR/task type          | 開発スタイル比較           | style、CI failure rate、review load、merge time、follow-up rate                |

## 解析で得られるもの

| 解析                 | 使用データ                                                               | 出力                                                   | 次の施策                              |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------- |
| tool call反復分析    | `opencode_tool_calls`, `gha_ci_result_snapshots`                         | 失敗しやすいコマンド、再実行が多い検証、CIログ確認回数 | repo別検証スクリプト、CI失敗分類skill |
| 初動探索パターン分析 | `opencode_messages`, `opencode_tool_calls`, `github_pr_files`            | 成功PRに共通する最初のread/grep/glob順                 | repo context pack、作業種別playbook   |
| review修正分析       | `github_review_threads`, `opencode_patches`, `github_commits`            | 指摘カテゴリ、修正回数、path別弱点                     | PR前チェック、coding guideline更新    |
| CI失敗分類           | `gha_ci_result_snapshots`, `github_check_runs`, `opencode_tool_calls`    | failure signature別の頻度、修正時間、再発率            | 自動診断、pre-commit/CI改善           |
| 規模と品質の相関     | `github_prs`, `github_pr_files`, `opencode_sessions`                     | files changed、token、turn数とreview/CI結果の関係      | 分割PR提案ルール                      |
| 開発スタイル比較     | `opencode_prompts`, `github_timeline_events`, `gha_post_merge_snapshots` | Spec-first/TDD/Review-driven/CI-repair別の成果         | task typeごとの推奨プロセス           |

## セキュリティとプライバシー

| リスク                                | 方針                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| PR from forkで任意コードが混入する    | telemetry workflowではPRコードを実行しない。diff取得だけに限定し、`pull_request`でread権限にする |
| `pull_request_target`の誤用           | PR本文更新などbase contextだけで完結する処理に限定する。head checkoutやscript実行をしない        |
| Actionsログにsecretや個人情報が混ざる | log excerptは最小化し、secret patternとtoken patternをredactし、全文保存しない                   |
| prompt/tool outputに機微情報が混ざる  | DuckDB投入前にURL、token、email、local pathなどのredaction policyを通す                          |
| artifact保持期限切れ                  | API syncでartifactを定期回収し、Parquetに永続化する                                              |

## 非目標

| 非目標                                     | 理由                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| ActionsでPR/review/commentを完全ミラーする | API/GraphQLで後から取れるため重複が大きい                                           |
| CIログ全文を保存する                       | 機微情報、容量、検索ノイズが大きい。failure signatureと短いredacted excerptで足りる |
| 最初からPostgreSQLやClickHouseを使う       | 現状はローカル横断分析が主目的で、DuckDB/Parquetが十分                              |
| 人間用GitHub labelを大量追加する           | 運用負荷が高い。まずDB側の `inferred_task_type` で分類する                          |

## 初期導入順

| 順序 | 作業                  | 完了条件                                                                        |
| ---- | --------------------- | ------------------------------------------------------------------------------- |
| 1    | entireログ正規化      | `opencode_sessions`, `opencode_tool_calls`, `opencode_patches` がDuckDBで読める |
| 2    | GitHub API同期        | PR、review、commits、files、checks、timelineがPR単位で取れる                    |
| 3    | checkpoint/PR結合検証 | `checkpoint_id`, PR URL、branch/time windowのlink confidenceが確認できる        |
| 4    | PR Event Snapshot     | 1 repoでActions artifactが生成され、API syncで回収できる                        |
| 5    | CI Result Snapshot    | failure signatureとtest summaryがCI失敗ごとに残る                               |
| 6    | 1週間分の手動レビュー | トイル候補、ガードレール候補、開発スタイル仮説を人間が確認できる                |
