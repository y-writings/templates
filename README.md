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

The `[00] Approve pull request from comment` workflow lets an authorized user ask
the existing approver GitHub App to approve an open pull request. Add a new comment
whose entire body is exactly `approve` to the pull request conversation. Comments
on issues, comments on closed or merged pull requests, edited comments, other text,
and comments from users outside the allowlist are ignored. The initial allowlist
contains only `y-writings`.

The workflow only submits an approving review. It does not enable auto-merge or
merge the pull request, and it does not check out or execute pull request code.

Repository administrators must configure the existing approver GitHub App with:

- A `PR_APPROVER_APP_ID` Actions variable containing the App ID.
- A `PR_APPROVER_APP_PRIVATE_KEY` Actions secret containing the App private key.
- **Pull requests: Read and write** permission on the App, with the App installed
  on this repository.

To change who may invoke the command, update the login check in
`.github/workflows/00-comment-approve.yaml`. Keep the full-body equality check for
`approve` so that prose containing the word does not trigger an approval.
