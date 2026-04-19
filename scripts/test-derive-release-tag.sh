#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
helper_script="${script_dir}/derive-release-tag.sh"

assert_equals() {
  expected="$1"
  actual="$2"
  message="$3"

  if [ "$expected" != "$actual" ]; then
    printf 'assertion failed: %s\nexpected: %s\nactual: %s\n' "$message" "$expected" "$actual" >&2
    exit 1
  fi
}

create_commit() {
  message="$1"
  content="$2"
  commit_date="$3"

  printf '%s\n' "$content" > tracked.txt
  git add tracked.txt
  GIT_AUTHOR_DATE="$commit_date" GIT_COMMITTER_DATE="$commit_date" git commit -m "$message" > /dev/null
  git rev-parse HEAD
}

run_helper() {
  commit_sha="$1"
  output_file="$2"

  GITHUB_OUTPUT="$output_file" bash "$helper_script" "$commit_sha"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cd "$tmp_dir"
git init > /dev/null
git config user.name 'Test User'
git config user.email 'test@example.com'

base_commit="$(create_commit 'base commit' 'base' '2026-04-19T09:00:00+09:00')"
target_commit="$(create_commit 'target commit' 'target' '2026-04-19T10:00:00+09:00')"
release_date='2026.04.19'
prefix3="$(printf '%s' "$target_commit" | cut -c1-3)"
prefix4="$(printf '%s' "$target_commit" | cut -c1-4)"

output_file="$(mktemp)"
run_helper "$target_commit" "$output_file"

tag="$(grep '^tag=' "$output_file" | cut -d= -f2-)"
tag_exists="$(grep '^tag_exists=' "$output_file" | cut -d= -f2-)"
assert_equals "v${release_date}-${prefix3}" "$tag" 'uses sha3 when no collision exists'
assert_equals 'false' "$tag_exists" 'reports missing tag for a new candidate'

git tag "v${release_date}-${prefix3}" "$base_commit"
output_file="$(mktemp)"
run_helper "$target_commit" "$output_file"

tag="$(grep '^tag=' "$output_file" | cut -d= -f2-)"
tag_exists="$(grep '^tag_exists=' "$output_file" | cut -d= -f2-)"
assert_equals "v${release_date}-${prefix4}" "$tag" 'extends prefix when a different commit already owns sha3 tag'
assert_equals 'false' "$tag_exists" 'reports false after choosing a longer unused tag'

git tag "v${release_date}-${prefix4}" "$target_commit"
output_file="$(mktemp)"
run_helper "$target_commit" "$output_file"

tag="$(grep '^tag=' "$output_file" | cut -d= -f2-)"
tag_exists="$(grep '^tag_exists=' "$output_file" | cut -d= -f2-)"
assert_equals "v${release_date}-${prefix4}" "$tag" 'reuses the existing matching tag for the same commit'
assert_equals 'true' "$tag_exists" 'reports true when the chosen tag already points at the same commit'

if bash "$helper_script" not-a-sha > /dev/null 2>&1; then
  printf 'expected invalid SHA invocation to fail\n' >&2
  exit 1
fi

printf 'all derive-release-tag tests passed\n'
