<!-- markdownlint-disable MD013 -->

# GitHubテレメトリ取得項目カタログ

作成日: 2026-06-17

## 基本方針

GitHubから取得するデータは、取得元ごとに責務を分ける。

| 取得元             | 使う場面                                           | 判断基準                                                                                       |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GitHub API/GraphQL | 後から再取得できるGitHub上の事実                   | PR、review、thread、commit、file、check、timelineのようにGitHubが保持している                  |
| GitHub Actions     | 後から再現しにくいイベント時点・runner実行時の証拠 | log excerpt、failure signature、test result、coverage、pre-merge状態、synchronize before/after |
| entire             | AI agentが何を見て何を実行したか                   | prompt、tool call、patch、token、session、checkpoint                                           |

## GitHub API/GraphQLで取得する項目

### Pull Request

| 項目                                                     | なぜ取得するか                                                 | entire/Actionsと合算してできること                                     |
| -------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `repo`, `owner`, `name`                                  | 全データの最上位結合キーになる                                 | repo別のAI作業量、review負荷、CI失敗率を比較できる                     |
| `number`, `id`, `node_id`, `url`                         | PRを安定参照するため                                           | promptやtool output内のPR URLと結合できる                              |
| `title`, `body`, `body length`                           | task type、issue link、Entire checkpoint sectionを抽出するため | 初期promptとPR説明の一致度、要求の明確さとreview負荷の関係を見られる   |
| `createdAt`, `updatedAt`, `closedAt`, `mergedAt`         | PRライフサイクルを測るため                                     | session開始からPR作成まで、PR作成からmergeまでの時間を測れる           |
| `isDraft`, draft解除イベント                             | draft運用を分析するため                                        | Spec-firstや大きな変更でdraft期間が品質に効くかを見られる              |
| `baseRefName`, `headRefName`, `baseRefOid`, `headRefOid` | branch/commit結合に必要                                        | entire `branch` とActions `head_sha` を介してsessionをPRへ結合できる   |
| `mergeCommit`                                            | merge後の追跡起点になる                                        | revert/follow-up PR、default branch CI失敗との関連を追える             |
| `additions`, `deletions`, `changedFiles`                 | PR規模の基本指標                                               | token使用量、tool call数、reviewコメント数、CI失敗率との相関を見られる |
| `labels`, `milestone`, `assignees`                       | 作業種別や優先度の補助情報になる                               | `inferred_task_type` の検証、label別の開発スタイル比較ができる         |

### Reviews

| 項目                         | なぜ取得するか                               | entire/Actionsと合算してできること                |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `review_id`, `node_id`       | reviewイベントを一意に識別するため           | review対応sessionと紐づけられる                   |
| `author`, `state`            | approve/comment/change requestを区別するため | change request率、approvalまでの修正量を測れる    |
| `submittedAt`, `commit.oid`  | review時点をcommitに結びつけるため           | review後にどのcommit/sessionで直したかを追える    |
| `body length`, `body digest` | reviewの重さを近似するため                   | 長文reviewと修正時間、token使用量の関係を見られる |

### Review Threads / Comments

| 項目                                                        | なぜ取得するか                           | entire/Actionsと合算してできること                                     |
| ----------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `thread_id`, `isResolved`, `isOutdated`                     | 指摘が解消されたかを測るため             | 未解決threadがmergeされたか、解消までの時間を見られる                  |
| `comment_id`, `author`, `createdAt`, `updatedAt`            | コメント単位の時系列が必要               | review comment URLを含むpromptと直接結合できる                         |
| `path`, `line`, `originalLine`, `diffHunk`                  | 指摘対象を特定するため                   | path別・言語別の繰り返し指摘を抽出できる                               |
| `commit_id`, `original_commit_id`, `pull_request_review_id` | 指摘時点のcommitとreviewを結びつけるため | 指摘後の修正commit、修正session、修正所要時間を追える                  |
| `body`, `body digest`, `category inference`                 | 指摘内容を分類するため                   | 権限、テスト不足、設計、命名、ドキュメントなどのカテゴリ別対策を作れる |

### Commits

| 項目                                              | なぜ取得するか                                  | entire/Actionsと合算してできること                                                                    |
| ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `sha`, `parents`                                  | commit graphを復元するため                      | 修正回数やcommit粒度を見られる。force push疑いはActionsの`synchronize_before/after`と併用して判断する |
| `message`                                         | `Entire-Checkpoint: <id>` trailerを抽出するため | checkpointとPRを高信頼で結合できる                                                                    |
| `authoredDate`, `committedDate`, `pushedDate相当` | 作業時系列を作るため                            | session時刻とcommit時刻の近さを使って結合信頼度を上げられる                                           |
| `author`, `committer`                             | bot、人間、AI支援作業の区別に使うため           | bot PRと人間主導PRを分けて分析できる                                                                  |

### Checks / Workflow Runs

| 項目                                           | なぜ取得するか                             | entire/Actionsと合算してできること                 |
| ---------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `run_id`, `run_attempt`, `workflow_name`       | Actions artifactと結合するため             | API上のrunとActions snapshotを結合できる           |
| `check_run_id`, `name`, `status`, `conclusion` | CI結果の基本情報                           | CI失敗率、required check別の失敗傾向を見られる     |
| `startedAt`, `completedAt`                     | durationを測るため                         | 遅いCIと開発待ち時間、rerunコストを測れる          |
| `detailsUrl`, `htmlUrl`                        | 失敗調査の参照先を残すため                 | tool output内のActions URLと結合できる             |
| `head_sha`                                     | PR snapshot、commit、sessionとの結合に必要 | どのsession/commitがどのCI結果を生んだかを見られる |

### Files / CODEOWNERS / Path Classification

| 項目                                  | なぜ取得するか                 | entire/Actionsと合算してできること                                  |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `path`, `status`, `previous_filename` | 変更対象の正規化               | `files_touched` とPR filesの重なりからsession結合を補強できる       |
| `additions`, `deletions`, `changes`   | path別規模を測るため           | 大きいfile変更とreview負荷、CI失敗の関係を見られる                  |
| language/classifier                   | task type推定に必要            | GitHub Actions系、Terraform、docs-only、test-onlyなどの比較ができる |
| CODEOWNERS owner                      | review要求の構造を理解するため | owner別のreview待ち時間、指摘カテゴリを測れる                       |

### Issues / Timeline

| 項目                                | なぜ取得するか               | entire/Actionsと合算してできること                                             |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| linked issue / closing issue        | PRの要求元を知るため         | bug/feature/choreなどの作業種別別に開発スタイルを比較できる                    |
| issue labels                        | task typeの教師信号になる    | 自動分類 `inferred_task_type` の精度確認ができる                               |
| timeline events                     | PR内の順序を復元するため     | review requestから初回reviewまで、CI failureから修正までなどの待ち時間を測れる |
| ready_for_review / review_requested | reviewプロセス開始を測るため | draft期間、review待ち、review開始後の修正量を分析できる                        |

## GitHub Actionsで取得する項目

### PR Event Snapshot

| 項目                                                                     | なぜActionsで取得するか                      | entire/APIと合算してできること                                          |
| ------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------- |
| `event_name`, `event_action`, `event_time`                               | イベント時点を固定するため                   | opened、synchronize、ready_for_reviewなど作業ステージ別に分析できる     |
| `run_id`, `run_attempt`, `workflow_ref`                                  | artifactとAPI runを結合するため              | artifact回収漏れやrerunを追跡できる                                     |
| `repo`, `pr_number`, `pr_node_id`                                        | PR snapshotの主キー                          | APIのPRテーブルと結合できる                                             |
| `head_sha`, `base_sha`, `head_ref`, `base_ref`                           | event時点のbranch/commitを固定するため       | branchが進んだ後でもsession/commitとの結合を保てる                      |
| `synchronize_before`, `synchronize_after`                                | force pushや大きな履歴変更を検知するため     | review後に履歴が置き換わったPRを識別できる                              |
| `is_draft`                                                               | draft状態の変化を取るため                    | draft解除前後の作業量やCI失敗率を比較できる                             |
| `title_type`, `title_scope`, `title_subject`, `body_hash`, `body_length` | PR本文の完全保存を避けつつ意図を要約するため | semantic titleと開発成果の関係を見られる                                |
| `linked_issues`, `linked_discussions`, `github_urls`                     | PR本文内の参照をイベント時点で固定するため   | issue起点作業とad-hoc作業を分けられる                                   |
| `entire_checkpoint_ids`                                                  | checkpointとの高信頼結合に必要               | OpenCode session、commit、PRの三者を結べる                              |
| `changed_file_count`, `diff_stat`, `name_status`                         | event時点の差分を固定するため                | synchronizeごとの変更規模増減を分析できる                               |
| path classifiers                                                         | 変更種別をすぐ分析できる形にするため         | workflow変更、test変更、docs-only、lockfile変更などのリスク分析ができる |

### CI Result Snapshot

| 項目                                        | なぜActionsで取得するか                          | entire/APIと合算してできること                        |
| ------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `source_run_id`, `source_run_attempt`       | 対象CI runを特定するため                         | API check runとartifactを結合できる                   |
| `workflow_name`, `job_name`, `job_id`       | 失敗箇所を構造化するため                         | workflow/job別の失敗率と修正時間を測れる              |
| `started_at`, `completed_at`, `duration_ms` | 実行コストを測るため                             | CI待ち時間と開発turn数の関係を見られる                |
| `conclusion`                                | 成功/失敗/キャンセルを区別するため               | PR単位のCI失敗回数やrerun回数を測れる                 |
| `failed_step_name`, `failed_step_number`    | ログ全文なしで失敗位置を残すため                 | どのstepが繰り返し壊れるかを特定できる                |
| `failure_signature`                         | 同じ失敗をgroup化するため                        | 同一原因の再発、修正パターン、skill化候補を抽出できる |
| `log_excerpt_redacted`                      | 最小限の診断証拠を残すため                       | entireのCI-repair sessionで読んだログと比較できる     |
| `test_summary`                              | runner上のtest結果は後から取れない場合があるため | test失敗数、失敗test名、flake疑いを分析できる         |
| `coverage_summary`                          | coverage artifactが失われる前に要約するため      | coverage低下とreview指摘/CI失敗の関係を見られる       |
| `artifact_manifest`                         | どのtest reportを読んだか追跡するため            | parserの欠落や形式変更を検出できる                    |

### Pre-Merge Snapshot

| 項目                                       | なぜActionsで取得するか            | entire/APIと合算してできること                            |
| ------------------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| `snapshot_time`, `head_sha`                | マージ直前に近い状態を固定するため | merge直前の状態と最終結果を比較できる                     |
| `required_checks`                          | merge gateの状態を知るため         | required check不足、flaky check、rerun待ちを分析できる    |
| `latest_successful_ci_at`                  | greenになった時刻を固定するため    | greenからmergeまでの待ち時間を測れる                      |
| `approval_count`, `change_requested_count` | review gateを要約するため          | review状態とmerge結果の関係を見られる                     |
| `unresolved_thread_count`                  | 未解決指摘を測るため               | 未解決のままmergeされたPRやriskを発見できる               |
| `commit_count`, `push_count`               | 修正ループ量を測るため             | 多push PRとreview/CI負荷の関係を見られる                  |
| final path classifiers                     | 最終変更種別を固定するため         | workflow変更やsecret周りの変更でpre-merge状態を確認できる |

### Post-Merge Snapshot

| 項目                                                              | なぜActionsで取得するか      | entire/APIと合算してできること                   |
| ----------------------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| `merged_at`, `merge_commit_sha`, `final_head_sha`                 | PR完了イベントを固定するため | sessionから成果までのend-to-end時間を測れる      |
| `time_to_merge_seconds`                                           | 成果指標の基本になる         | 開発スタイル別のmerge速度を比較できる            |
| `final_additions`, `final_deletions`, `final_changed_files`       | 最終規模を固定するため       | 初期snapshotから最終snapshotまでの膨張を見られる |
| `review_comment_count`, `thread_count`, `unresolved_thread_count` | review負荷を要約するため     | review reworkとOpenCode作業量の相関を見られる    |
| `ci_failure_count`, `rerun_count`                                 | CI負荷を要約するため         | CI-repair sessionが成功率に効いたかを見られる    |
| `default_branch_run_id`                                           | merge後の本線CI追跡起点      | merge後破壊、follow-up、revertの検出に使える     |

## entireから抽出する項目

| 項目                                            | なぜ取得するか                               | GitHub側と合算してできること                               |
| ----------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `checkpoint_id`                                 | GitHub commit trailerやPR bodyと結合するため | AI作業単位とPR成果を高信頼で結べる                         |
| `session_id`                                    | OpenCode sessionの主キー                     | session単位でtool usage、patch、GitHub outcomeを比較できる |
| `created_at`, transcript `time.created/updated` | session時系列を作るため                      | PRイベントやCI失敗との前後関係を追える                     |
| `branch`                                        | PR head branchとの結合補助                   | checkpoint trailerがない場合の候補リンクを作れる           |
| `info.directory`                                | repo推定に必要                               | GitHub `owner/repo` と結合できる                           |
| `prompt.txt`, user messages                     | 作業目的とGitHub URL抽出に必要               | review URL起点、CI URL起点、PR URL起点の作業を分類できる   |
| `tool_calls.tool`                               | agentの行動を分類するため                    | 成功PRの探索順、CI修正時のログ確認有無を分析できる         |
| `tool_calls.input/output digest`                | command、URL、失敗内容を抽出するため         | GitHub API確認やCIログ確認の反復を検出できる               |
| `tool_calls.status`, `exit_code`, `duration`    | tool失敗や時間コストを測るため               | 失敗コマンドの反復、トイル候補を見つけられる               |
| `patches` / edit operations                     | 実際に何を変更したかを見るため               | review comment対象pathやCI失敗pathとの対応を見られる       |
| `files_touched`                                 | 変更範囲の要約                               | PR filesとのoverlapで結合信頼度を上げられる                |
| `token_usage`                                   | AIコストを見るため                           | PR規模、review負荷、CI失敗とのコスト相関を出せる           |
| `initial_attribution`, `prompt_attributions`    | AI/人間の変更比率を見るため                  | AI寄与率とreview/CI結果の関係を測れる                      |

## 派生指標

| 指標                             | 算出元                                             | 意味                                     | 使い道                                        |
| -------------------------------- | -------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `first_patch_latency`            | session start、最初のpatch                         | 調査から編集までの時間                   | 探索過多やcontext不足を検出する               |
| `verification_count`             | bash/test/lint/build tool calls                    | 検証回数                                 | 未検証PRや過剰rerunを見つける                 |
| `failed_tool_ratio`              | tool calls status/exit                             | agent作業の摩擦                          | tool/command整備候補を見つける                |
| `ci_failure_to_repair_latency`   | CI snapshot、session time、commit time             | CI失敗から修正までの時間                 | CI-repair playbookの効果を見る                |
| `review_comment_to_fix_latency`  | review comment、commit/session                     | review指摘から修正までの時間             | review対応のボトルネックを見つける            |
| `pr_growth_after_first_snapshot` | PR snapshots、final PR stats                       | PRが途中で膨らんだ量                     | 分割PR提案条件を作る                          |
| `task_type_inferred`             | title/body/path/prompt/review                      | 自動分類された作業種別                   | label運用なしでスタイル比較する               |
| `development_style_inferred`     | prompt、timeline、tool sequence                    | Spec-first/TDD/Review-driven/CI-repair等 | 作業種別別の推奨スタイルを決める              |
| `toil_signature`                 | repeated commands/log signatures/review categories | 繰り返し発生する非本質作業               | skill化、CI改善、テンプレート改善の候補にする |

## 取得しない項目

| 項目                                                        | 取得しない理由                             | 代替                                                          |
| ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| PR comments/review commentsの全履歴をActions artifactに保存 | API/GraphQLで取得でき、Actions重複が大きい | GitHub API同期で取得する                                      |
| CIログ全文                                                  | 機微情報、容量、ノイズが大きい             | redacted excerpt、failure signature、failed stepを保存する    |
| runner workspace全体                                        | セキュリティと容量の問題が大きい           | test summary、coverage summary、artifact manifestだけ保存する |
| 人間用分類labelの大量追加                                   | 運用負荷が高く、過去データに適用できない   | `inferred_task_type` をDB側で持つ                             |
