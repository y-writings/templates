# GitHub settings for `changelog.yml`

This repository uses `git-cliff` as the single source of truth for `CHANGELOG.md`. The `.github/workflows/changelog.yml` workflow regenerates `CHANGELOG.md` from git history and commits the result back to the default branch.

## 1. Allow GitHub Actions to run in the repository

1. Open `Settings > Actions > General`.
2. In **Actions permissions**, choose the option that allows GitHub Actions to run in this repository.
3. If your organization restricts actions by allowlist, add these actions to the allowlist:
   - `actions/checkout`
   - `orhun/git-cliff-action`

## 2. Enable write access for the workflow token

1. Open `Settings > Actions > General`.
2. Scroll to **Workflow permissions**.
3. Select **Read and write permissions**.
4. Save the setting.

Why this is required:

- `.github/workflows/changelog.yml` commits the regenerated `CHANGELOG.md` back to the repository.
- That push uses `secrets.GITHUB_TOKEN`, which must be allowed to write repository contents.

## 3. Confirm no extra repository secret is required

1. Open `Settings > Secrets and variables > Actions`.
2. Confirm that no additional secret is needed for `.github/workflows/changelog.yml` under the default setup.
3. Do **not** create a custom token unless your organization disables write access for the built-in `GITHUB_TOKEN`.

Notes:

- The workflow uses the built-in `secrets.GITHUB_TOKEN`.
- No extra repository secret is required for the default `git-cliff` workflow.

## 4. Keep the workflow triggers usable

1. Open `Settings > Actions > General`.
2. Confirm workflows are allowed to run on the default branch.
3. Confirm pushes to the default branch are allowed to trigger workflows.

Why this matters:

- `changelog.yml` runs automatically on pushes to `main` except changelog-only commits.
- Maintainers can still use `Actions > changelog > Run workflow` to regenerate `CHANGELOG.md` manually.
- The workflow requires the full git history in Actions so `git-cliff` can calculate the changelog correctly.

## 5. Check branch protection compatibility

1. Open `Settings > Branches`.
2. Review the rule that applies to your default branch.
3. Confirm the rule does not block this workflow’s behavior.

Important detail:

- `changelog.yml` pushes a commit to the default branch when `CHANGELOG.md` changes.
- If branch protection blocks direct pushes from `GITHUB_TOKEN`, you must either allow GitHub Actions to bypass that protection or adjust your branch policy before enabling this workflow.

## 6. Understand the `git-cliff` ownership model

1. Open `.github/workflows/changelog.yml` in the repository.
2. Open `cliff.toml` in the repository.
3. Confirm that `CHANGELOG.md` is intended to be generated only by `git-cliff`.

Expected behavior:

- `git-cliff` is the single writer of `CHANGELOG.md`.
- `changelog.yml` regenerates the file from git history using `cliff.toml`.
- Commits that only touch `CHANGELOG.md` do not re-trigger the workflow because the push trigger ignores that path.

## 7. Manual run procedure for maintainers

1. Open `Actions > changelog`.
2. Click **Run workflow**.
3. Run the workflow.
4. Open the workflow run logs and confirm that `CHANGELOG.md` was either updated and committed or skipped because there were no changes.
5. Open the repository root and confirm the latest `CHANGELOG.md` is present on the default branch.

## 8. Troubleshooting

1. If the workflow fails with permission errors, reopen `Settings > Actions > General > Workflow permissions` and confirm **Read and write permissions** is selected.
2. If the workflow fails because the action is blocked, reopen `Settings > Actions > General` and update the allowlist policy.
3. If the workflow cannot push to `main`, review `Settings > Branches` and adjust branch protection so GitHub Actions can update `CHANGELOG.md`.
4. If the workflow runs but the changelog is incomplete, confirm the workflow still checks out the repository with `fetch-depth: 0` and that tags are available in the repository history.
