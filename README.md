# Templates

This repository manages baseline configuration for repositories maintained by [y-writings](https://github.com/y-writings).

It is designed to be used with [driftline](https://github.com/y-writings/driftline) to apply these baseline settings across those repositories.

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
