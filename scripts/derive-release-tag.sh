#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -gt 0 ]; then
  printf 'usage: %s\n' "$0" >&2
  exit 1
fi

snapshot_date="${SNAPSHOT_DATE:-$(date -u +'%Y.%m.%d')}"

if ! printf '%s\n' "$snapshot_date" | grep -Eq '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$'; then
  printf 'snapshot date must use YYYY.MM.DD format\n' >&2
  exit 1
fi

candidate_tag="v${snapshot_date}"

if git rev-parse --verify --quiet "refs/tags/${candidate_tag}^{commit}" > /dev/null; then
  tag_exists=true
else
  tag_exists=false
fi

output_target="${GITHUB_OUTPUT:-/dev/stdout}"
{
  printf 'tag=%s\n' "$candidate_tag"
  printf 'tag_exists=%s\n' "$tag_exists"
} >> "$output_target"
