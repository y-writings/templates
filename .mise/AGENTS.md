# Mise Config Rules

When adding or changing tasks in `.mise/config.baseline.toml`, follow these rules:

- Tasks in `config.baseline.toml` must use the `00:` prefix.
- Child tasks must set `hide = true` so that `mise tasks` only shows parent tasks.
