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

run_helper() {
  snapshot_date="$1"
  output_file="$2"

  SNAPSHOT_DATE="$snapshot_date" GITHUB_OUTPUT="$output_file" bash "$helper_script"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cd "$tmp_dir"
git init > /dev/null
git config user.name 'Test User'
git config user.email 'test@example.com'

printf 'base\n' > tracked.txt
git add tracked.txt
git commit -m 'chore: create test fixture' > /dev/null

snapshot_date='2026.04.19'

output_file="$(mktemp)"
run_helper "$snapshot_date" "$output_file"

tag="$(grep '^tag=' "$output_file" | cut -d= -f2-)"
tag_exists="$(grep '^tag_exists=' "$output_file" | cut -d= -f2-)"
assert_equals "v${snapshot_date}" "$tag" 'uses the snapshot date as the complete tag name'
assert_equals 'false' "$tag_exists" 'reports missing tag for a new candidate'

git tag "v${snapshot_date}" HEAD
output_file="$(mktemp)"
run_helper "$snapshot_date" "$output_file"

tag="$(grep '^tag=' "$output_file" | cut -d= -f2-)"
tag_exists="$(grep '^tag_exists=' "$output_file" | cut -d= -f2-)"
assert_equals "v${snapshot_date}" "$tag" 'reuses the same date tag when it already exists'
assert_equals 'true' "$tag_exists" 'reports true when the date tag already exists'

if SNAPSHOT_DATE='2026-04-19' bash "$helper_script" > /dev/null 2>&1; then
  printf 'expected invalid snapshot date invocation to fail\n' >&2
  exit 1
fi

printf 'all derive-release-tag tests passed\n'
