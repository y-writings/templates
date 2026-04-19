#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <merge-commit-sha>\n' "$0" >&2
  exit 1
fi

merge_commit_sha="$1"

if ! printf '%s\n' "$merge_commit_sha" | grep -Eq '^[0-9a-f]{40}$'; then
  printf 'merge commit SHA must be a lowercase 40-character git SHA\n' >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "${merge_commit_sha}^{commit}" > /dev/null; then
  printf 'merge commit SHA %s does not resolve to a commit\n' "$merge_commit_sha" >&2
  exit 1
fi

release_date="$(git show -s --format=%cd --date=format:'%Y.%m.%d' "$merge_commit_sha")"

if [ -z "$release_date" ]; then
  printf 'could not derive a release date from commit %s\n' "$merge_commit_sha" >&2
  exit 1
fi

prefix_length=3

while [ "$prefix_length" -le 40 ]; do
  short_sha="$(printf '%s' "$merge_commit_sha" | cut -c1-"$prefix_length")"
  candidate_tag="v${release_date}-${short_sha}"

  if git rev-parse --verify --quiet "refs/tags/${candidate_tag}^{commit}" > /dev/null; then
    existing_commit="$(git rev-parse "refs/tags/${candidate_tag}^{commit}")"

    if [ "$existing_commit" = "$merge_commit_sha" ]; then
      tag_exists=true
      break
    fi

    prefix_length=$((prefix_length + 1))
    continue
  fi

  tag_exists=false
  break
done

if [ "$prefix_length" -gt 40 ]; then
  printf 'could not derive a unique tag name from commit %s\n' "$merge_commit_sha" >&2
  exit 1
fi

output_target="${GITHUB_OUTPUT:-/dev/stdout}"
{
  printf 'tag=%s\n' "$candidate_tag"
  printf 'tag_exists=%s\n' "$tag_exists"
} >> "$output_target"
