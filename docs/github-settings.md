# GitHub settings for weekly snapshot workflows

This repository creates weekly snapshot tags on `main` and keeps `CHANGELOG.md` as a generated summary of the tagged history. The tags are information boundaries for downstream repositories, not the final end-user release vehicle.

## 1. Allow GitHub Actions to run in the repository

1. Open `Settings > Actions > General`.
2. In **Actions permissions**, choose the option that allows GitHub Actions to run in this repository.
3. If your organization restricts actions by allowlist, add these actions to the allowlist:
   - `actions/checkout`
   - `orhun/git-cliff-action`
   - `peter-evans/create-pull-request`

## 2. Enable write access for the workflow token

1. Open `Settings > Actions > General`.
2. Scroll to **Workflow permissions**.
3. Select **Read and write permissions**.
4. Save the setting.

Why this is required:

- `.github/workflows/release-tag.yml` pushes weekly snapshot tags to the repository.
- `.github/workflows/changelog.yml` creates or updates a pull request for `CHANGELOG.md`.

## 3. Confirm no extra repository secret is required

1. Open `Settings > Secrets and variables > Actions`.
2. Confirm that no additional secret is needed for the default setup.
3. Do **not** create a custom automation token unless your organization disables write access for the built-in `GITHUB_TOKEN`.

Notes:

- Both workflows use the built-in `secrets.GITHUB_TOKEN`.
- The weekly snapshot model does not require GitHub App credentials.

## 4. Keep the workflow triggers usable

1. Open `Settings > Actions > General`.
2. Confirm workflows are allowed to run on the default branch.
3. Confirm scheduled workflows are allowed to run.

Why this matters:

- `release-tag.yml` creates one `vYYYY.MM.DD` snapshot tag every Monday at `00:00` UTC unless a maintainer runs it manually.
- `changelog.yml` refreshes `CHANGELOG.md` after a successful weekly snapshot run or on manual dispatch.
- Both workflows require the full git history in Actions so `git-cliff` can calculate the changelog correctly.

## 5. Check branch protection compatibility

1. Open `Settings > Branches`.
2. Review the rule that applies to the default branch.
3. Confirm the rule does not block workflow-created tags or changelog pull requests.

Important detail:

- The snapshot workflow tags the current `main` history but does not push commits directly to `main`.
- The changelog workflow opens a pull request from `automation/update-changelog` instead of bypassing branch protection.

## 6. Understand the weekly snapshot model

1. Open `.github/workflows/release-tag.yml` in the repository.
2. Open `.github/workflows/changelog.yml` in the repository.
3. Open `cliff.toml` in the repository.
4. Open `version.yaml` in the repository.

Expected behavior:

- `main` is the only branch that receives snapshot tags.
- Weekly tags use the format `vYYYY.MM.DD`.
- `CHANGELOG.md` is a generated summary of tagged history, not a release approval gate.
- The cadence metadata in `version.yaml` documents the intended weekly schedule.

## 7. Manual run procedure for maintainers

### Create or recover a weekly snapshot tag

1. Open `Actions > weekly-snapshot`.
2. Click **Run workflow**.
3. Run the workflow on `main`.
4. Optionally set `snapshot_date` in `YYYY.MM.DD` format to recover a missed weekly run.
5. Open the workflow run logs and confirm the tag was either created or skipped because it already exists.

### Regenerate the changelog summary

1. Open `Actions > changelog`.
2. Click **Run workflow**.
3. Run the workflow.
4. Open the workflow run logs and confirm that `CHANGELOG.md` was either updated in `automation/update-changelog` or skipped because there were no changes.

## 8. Troubleshooting

1. If the workflow fails with permission errors, reopen `Settings > Actions > General > Workflow permissions` and confirm **Read and write permissions** is selected.
2. If the workflow fails because the action is blocked, reopen `Settings > Actions > General` and update the allowlist policy.
3. If the snapshot workflow cannot push tags, review repository rules around tag creation and verify that `contents: write` is available to `GITHUB_TOKEN`.
4. If the changelog is incomplete, confirm the workflows still check out the repository with `fetch-depth: 0` and that tags are available in the repository history.

## 9. Include Entire checkpoint IDs in squash commit messages

This repository can keep `Entire-Checkpoint` IDs in squash commit messages by updating the PR body automatically.

1. Open `Settings > General > Pull Requests`.
2. In **Allow squash merging**, keep squash merge enabled.
3. Set **Default commit message** for squash merges to **Pull request title and description**.
4. Confirm `.github/workflows/add-entire-checkpoints-to-pr-body.yml` is present on the default branch.

Why this is required:

- The workflow scans commit messages in the PR and finds lines that start with `Entire-Checkpoint:`.
- It writes or refreshes the `Entire checkpoints` section in the PR body.
- Squash merge includes that PR body section in the final commit message only when the default mode is **Pull request title and description**.

Operational notes:

- The workflow uses marker comments (`<!-- entire-checkpoints:start -->` and `<!-- entire-checkpoints:end -->`) and replaces only that range.
- Maintainer-written parts of the PR description stay untouched.
- The workflow runs on `pull_request_target` events: `opened`, `synchronize`, `edited`, and `reopened`.
