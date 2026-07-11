# Managed Pull Request Template

## Goal

Keep `.github/pull_request_template.md` synchronized across target repositories
through driftline.

## Design

Add the existing pull request template to `.driftline-source.toml` under a new
`github` group:

```toml
[files.github]
pull-request-template = {
  path = ".github/pull_request_template.md",
  mode = "managed"
}
```

The group separates general GitHub repository files from the existing
`github-workflows` group. The stable file key is
`github.pull-request-template`, and the source and default target paths are
identical.

Managed mode causes driftline to record the file in target manifests and keep
its contents synchronized. Existing unowned target files remain subject to
driftline's normal conflict and adoption behavior.

## Scope

- Update only `.driftline-source.toml`.
- Keep `.github/pull_request_template.md` unchanged.
- Do not alter driftline runtime behavior or target repository configuration directly.

## Verification

- Confirm `.driftline-source.toml` remains valid TOML 1.1.
- Confirm the source manifest accepts the new path and `managed` mode.
- Confirm the repository diff contains only the intended manifest entry and
  this design record.
