# Templates

This repository manages baseline configuration for repositories maintained by [y-writings](https://github.com/y-writings).

It is designed to be used with [driftline](https://github.com/y-writings/driftline) to apply these baseline settings across those repositories.

## PR diff statistics

The `PR diff statistics` workflow groups the files changed by a pull request
according to `.github/pr-diff-groups.json`. The top-level `output` setting
selects where the report is maintained:

- `"comment"` creates or updates the action's fixed pull request comment. This
  is also the default when `output` is omitted.
- `"pr-body"` updates a report region in the pull request body. The shared
  configuration uses this mode.

For `pr-body` mode, place exactly one ordered marker pair wherever the report
should appear in the pull request template:

```markdown
<!-- pr-diff-statistics:start -->
_Statistics are added after the pull request is opened._
<!-- pr-diff-statistics:end -->
```

The action preserves the markers and everything outside them. If neither
marker exists, it appends the marked region to the body; malformed, reversed,
or duplicate markers cause the action to fail without modifying the body.

The workflow token needs `contents: read` to load configuration from the pull
request head and `pull-requests: write` to update either the pull request body
or its fixed comment. No separate action input is needed to select the output.

## Approving a pull request from a comment

The `[00] Approve pull request from comment` workflow submits an approving
review. It does not enable auto-merge or merge the pull request, and it does
not check out or execute pull request code. The documentation job checks out
the repository default branch so it can run the classifier that ships with that
branch.

### Comment command

An authorized user can ask the approver GitHub App to approve an open pull
request. Add a new comment whose entire body is exactly `approve` to the pull
request conversation. Comments on issues, comments on closed or merged pull
requests, edited comments, other text, and comments from users outside the
allowlist are ignored. The initial allowlist contains only `y-writings`.

To change who may invoke the command, update the login check in
`.github/workflows/00-comment-approve.yaml`. Keep the full-body equality check
for `approve` so that prose containing the word does not trigger an approval.

### Documentation and non-executable configuration

A pull request that changes only documentation or non-executable configuration
is approved without that comment. The extra job runs on `pull_request_target`,
so the workflow and `.github/scripts/comment-approve-docs.mjs` come from the
default branch rather than the pull request. It lists changed files and git
modes through the GitHub API. Every path must be on the script's allowlist, and
every added, modified, renamed, or removed blob must be a regular
non-executable file (`100644`).

Safe documentation is Markdown, reStructuredText, AsciiDoc, license and notice
filenames, and image assets (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`).
Safe configuration is a fixed set of formatter, linter, editor, gitignore,
changelog, and diff-group files, such as `.gitignore`, `cliff.toml`,
`tombi.toml`, `tsconfig.json`, and `.github/pr-diff-groups.json`. The exact
list is in the script.

These paths are never safe, even when the name looks like documentation:
`.github/workflows/**`, `.github/actions/**`, GitHub Action definitions,
scripts, build files, lockfiles, task-runner and CI configuration, and
`CODEOWNERS`. A symlink, submodule, executable bit, truncated tree, incomplete
file list, or unrecognized path is not safe. The pull request then stays
unapproved until an allowlisted user comments `approve`.

PR Diff Lens is not the approval signal. It publishes a Markdown table from
suffix groups stored on the pull request head. Those groups cannot exclude a
workflow directory from other files with the same suffix, and the pull request
can redefine them. When GitHub truncates the file list, the action reports that
statistics are unavailable instead of making a decision.

The job approves only the classified head and base SHAs. If either SHA changes
before the review is submitted, it does not approve that run. If a later commit
leaves the allowlist, the job dismisses approving reviews whose body contains
`<!-- docs-config-auto-approve -->` and whose author is the approver app.
Approvals created by the `approve` comment do not contain that marker.

Both `.github/workflows/00-comment-approve.yaml` (`github.comment-approve`) and
`.github/scripts/comment-approve-docs.mjs` (`github.comment-approve-docs`) are
driftline managed files. Apply them together with `driftline update` in each
target repository after this change is on `main`.

Repository administrators must configure the existing approver GitHub App with:

- A `PR_APPROVER_APP_ID` Actions variable containing the App ID.
- A `PR_APPROVER_APP_PRIVATE_KEY` Actions secret containing the App private key.
- **Pull requests: Read and write** permission on the App, with the App installed
  on this repository.
