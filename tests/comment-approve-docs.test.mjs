import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTO_APPROVE_MARKER,
  REVIEW_BODY,
  applyPinnedDecision,
  classify,
  createClient,
  evaluate,
  execute,
  indexTree,
  nextLink,
  pathDecision,
} from "../.github/scripts/comment-approve-docs.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MOVED = "c".repeat(40);
const LOGIN = "y-writings-approver[bot]";

function blob(path, mode = "100644", type = "blob") {
  return { path, mode, type };
}

function entries(paths, mode = "100644", type = "blob") {
  return indexTree(paths.map((path) => blob(path, mode, type)));
}

function pull(overrides = {}) {
  return {
    state: "open",
    changed_files: 1,
    head: { sha: HEAD },
    base: { sha: BASE },
    ...overrides,
  };
}

function snapshot({
  files,
  head = [],
  base = head,
  pulls,
  reviews = [],
  headTruncated = false,
  baseTruncated = false,
  missingTree = false,
}) {
  const headTree = "1".repeat(40);
  const baseTree = "2".repeat(40);
  const current = pull({ changed_files: files.length });
  let pullCalls = 0;
  const posts = [];
  const dismissals = [];
  const client = {
    posts,
    dismissals,
    async request(method, path, body) {
      if (method === "GET" && /\/pulls\/\d+$/.test(path)) {
        const list = pulls ?? [current, current];
        const next = list[Math.min(pullCalls, list.length - 1)];
        pullCalls += 1;
        return next;
      }
      if (method === "GET" && path.includes("/git/commits/")) {
        if (missingTree) throw new Error("commit unavailable");
        const sha = path.split("/").pop();
        if (sha === HEAD) return { tree: { sha: headTree } };
        if (sha === BASE) return { tree: { sha: baseTree } };
        throw new Error(`unexpected commit ${sha}`);
      }
      if (method === "GET" && path.includes("/git/trees/")) {
        const sha = path.split("?")[0].split("/").pop();
        if (sha === headTree) {
          return { truncated: headTruncated, tree: head.map((path) => blob(path)) };
        }
        if (sha === baseTree) {
          return { truncated: baseTruncated, tree: base.map((path) => blob(path)) };
        }
        throw new Error(`unexpected tree ${sha}`);
      }
      if (method === "POST" && path.endsWith("/reviews")) {
        posts.push(body);
        return { id: 50 };
      }
      if (method === "PUT" && path.includes("/dismissals")) {
        dismissals.push(body);
        return {};
      }
      throw new Error(`${method} ${path}`);
    },
    async paginate(path) {
      if (path.endsWith("/files")) return files;
      if (path.endsWith("/reviews")) return reviews;
      throw new Error(`paginate ${path}`);
    },
  };
  return { client, posts, dismissals };
}

test("allowlists documentation and non-executable configuration", () => {
  const paths = [
    "WEEKLY_MERGED_PULL_REQUESTS.md",
    "CHANGELOG.md",
    "docs/guide.markdown",
    "docs/guide.rst",
    "docs/guide.adoc",
    "docs/guide.asciidoc",
    "LICENSE",
    "LICENSE.txt",
    "NOTICE",
    ".github/pull_request_template.md",
    "docs/diagram.png",
    "docs/diagram.SVG",
    ".gitignore",
    ".editorconfig",
    "cliff.toml",
    "tombi.toml",
    ".pinact.yaml",
    ".prettierrc.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "biome.json",
    ".commitlintrc.yaml",
    ".github/pr-diff-groups.json",
    ".github/FUNDING.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
  ];
  const head = entries(paths);
  const result = classify(
    paths.map((filename) => ({ filename, status: "added" })),
    head,
    new Map(),
  );
  assert.equal(result.safe, true, result.reason);
});

test("rejects executable code, workflows, builds, locks, and unclear paths", () => {
  const cases = [
    [".github/workflows/ci.yml", "workflow or action directory"],
    [".github/workflows/README.md", "workflow or action directory"],
    [".GitHub/Actions/guide.md", "workflow or action directory"],
    ["action.yml", "GitHub Action definition"],
    ["src/main.ts", "executable source"],
    ["scripts/deploy.sh", "executable source"],
    ["package.json", "build, lock, task, or CI file"],
    ["pnpm-lock.yaml", "build, lock, task, or CI file"],
    ["go.sum", "build, lock, task, or CI file"],
    ["flake.nix", "build, lock, task, or CI file"],
    ["Dockerfile", "build or CI file"],
    ["Dockerfile.ci", "build or CI file"],
    ["compose.yaml", "build, lock, task, or CI file"],
    ["lefthook.yaml", "build, lock, task, or CI file"],
    ["Makefile", "build, lock, task, or CI file"],
    ["requirements-dev.txt", "build or CI file"],
    ["CODEOWNERS", "build, lock, task, or CI file"],
    [".github/dependabot.yml", "build, lock, task, or CI file"],
    ["renovate.json", "build, lock, task, or CI file"],
    [".mise/config.toml", "not documentation or non-executable configuration"],
    ["notes.xyz", "not documentation or non-executable configuration"],
    ["../README.md", "invalid"],
    ["docs/../../.github/workflows/ci.yml", "invalid"],
  ];
  for (const [filename, expected] of cases) {
    const result = classify(
      [{ filename, status: "added" }],
      entries([filename]),
      new Map(),
    );
    assert.equal(result.safe, false, filename);
    assert.match(result.reason, new RegExp(expected), result.reason);
  }
});

test("requires a regular non-executable blob on every side the diff touches", () => {
  const readme = entries(["README.md"]);
  assert.equal(
    classify([{ filename: "README.md", status: "added" }], entries(["README.md"], "100755"), new Map()).safe,
    false,
  );
  assert.equal(
    classify([{ filename: "README.md", status: "added" }], entries(["README.md"], "120000"), new Map()).safe,
    false,
  );
  assert.equal(
    classify([{ filename: "vendor/lib", status: "modified" }], entries(["vendor/lib"], "160000", "commit"), entries(["vendor/lib"], "160000", "commit")).safe,
    false,
  );
  assert.equal(
    classify([{ filename: "CHANGELOG.md", status: "removed" }], new Map(), readme).safe,
    false,
  );
  assert.equal(
    classify([{ filename: "CHANGELOG.md", status: "removed" }], new Map(), entries(["CHANGELOG.md"])).safe,
    true,
  );
  assert.equal(
    classify([{ filename: "package.json", status: "removed" }], new Map(), entries(["package.json"])).safe,
    false,
  );
  assert.equal(
    classify(
      [{ filename: "README.md", status: "renamed", previous_filename: "script.sh" }],
      readme,
      entries(["script.sh"]),
    ).safe,
    false,
  );
  assert.equal(
    classify(
      [{ filename: "docs/README.md", status: "renamed", previous_filename: "README.md" }],
      entries(["docs/README.md"]),
      readme,
    ).safe,
    true,
  );
  assert.equal(
    classify(
      [{ filename: "docs/ci.md", status: "copied", previous_filename: ".github/workflows/ci.yml" }],
      entries(["docs/ci.md"]),
      entries([".github/workflows/ci.yml"]),
    ).safe,
    false,
  );
  assert.equal(
    classify([{ filename: "README.md", status: "modified" }], readme, entries(["README.md"], "100755")).safe,
    false,
  );
  assert.equal(classify([], readme, readme).safe, false);
  assert.equal(
    classify([{ filename: "README.md", status: "weird" }], readme, readme).safe,
    false,
  );
  assert.equal(
    classify(
      [
        { filename: "README.md", status: "added" },
        { filename: "src/main.ts", status: "added" },
      ],
      entries(["README.md", "src/main.ts"]),
      new Map(),
    ).safe,
    false,
  );
  assert.equal(pathDecision(".github/workflows/README.md").ok, false);
});

test("classifies a live docs-only diff and fails closed when metadata is unclear", async () => {
  const safe = snapshot({
    files: [{ filename: "WEEKLY_MERGED_PULL_REQUESTS.md", status: "added" }],
    head: ["WEEKLY_MERGED_PULL_REQUESTS.md"],
    base: [],
  });
  const safeDecision = await evaluate(safe.client, {
    owner: "y-writings",
    repo: "window-nest",
    pull_number: 7,
  });
  assert.equal(safeDecision.safe, true, safeDecision.reason);
  assert.equal(safeDecision.dismiss, false);
  assert.equal(safeDecision.headSha, HEAD);

  const marker = {
    id: 9,
    state: "APPROVED",
    body: REVIEW_BODY,
    user: { login: LOGIN },
    commit_id: HEAD,
  };
  const mismatch = snapshot({
    files: [{ filename: "README.md", status: "added" }],
    head: ["README.md"],
    reviews: [marker],
  });
  mismatch.client.paginate = async (path) => {
    if (path.endsWith("/files")) return [{ filename: "README.md", status: "added" }];
    if (path.endsWith("/reviews")) return [marker];
    throw new Error(path);
  };
  const listed = await evaluate(
    {
      ...mismatch.client,
      async request(method, path, body) {
        if (method === "GET" && /\/pulls\/\d+$/.test(path)) {
          return pull({ changed_files: 2 });
        }
        return mismatch.client.request(method, path, body);
      },
    },
    { owner: "o", repo: "r", pull_number: 7 },
  );
  assert.equal(listed.safe, false);
  assert.equal(listed.dismiss, true);
  assert.match(listed.reason, /incomplete/);

  const truncated = snapshot({
    files: [{ filename: "README.md", status: "added" }],
    head: ["README.md"],
    reviews: [marker],
    headTruncated: true,
  });
  const truncatedDecision = await evaluate(truncated.client, {
    owner: "o",
    repo: "r",
    pull_number: 7,
  });
  assert.equal(truncatedDecision.safe, false);
  assert.equal(truncatedDecision.dismiss, true);
  assert.match(truncatedDecision.reason, /truncated/);

  const unavailable = snapshot({
    files: [{ filename: "README.md", status: "added" }],
    head: ["README.md"],
    reviews: [marker],
    missingTree: true,
  });
  const unavailableDecision = await evaluate(unavailable.client, {
    owner: "o",
    repo: "r",
    pull_number: 7,
  });
  assert.equal(unavailableDecision.safe, false);
  assert.equal(unavailableDecision.dismiss, true);

  const closed = snapshot({
    files: [],
    pulls: [pull({ state: "closed", changed_files: 0 })],
  });
  const closedDecision = await evaluate(closed.client, {
    owner: "o",
    repo: "r",
    pull_number: 7,
  });
  assert.equal(closedDecision.safe, false);
  assert.equal(closedDecision.dismiss, false);

  const moved = snapshot({
    files: [{ filename: "README.md", status: "added" }],
    head: ["README.md"],
    reviews: [marker],
    pulls: [pull(), pull({ head: { sha: MOVED } })],
  });
  const movedDecision = await evaluate(moved.client, {
    owner: "o",
    repo: "r",
    pull_number: 7,
  });
  assert.equal(movedDecision.safe, false);
  assert.match(movedDecision.reason, /changed while/);
});

test("approves the pinned commit and dismisses only this app's marker review", async () => {
  const target = { owner: "o", repo: "r", pull_number: 7 };
  const approved = snapshot({
    files: [],
    pulls: [pull(), pull()],
    reviews: [],
  });
  const approval = await applyPinnedDecision(approved.client, target, {
    login: LOGIN,
    headSha: HEAD,
    baseSha: BASE,
    safe: true,
  });
  assert.equal(approval.action, "approved");
  assert.equal(approved.posts[0].commit_id, HEAD);
  assert.equal(approved.posts[0].event, "APPROVE");
  assert.match(approved.posts[0].body, new RegExp(AUTO_APPROVE_MARKER));
  assert.equal(approved.dismissals.length, 0);

  const stale = snapshot({
    files: [],
    pulls: [pull({ head: { sha: MOVED } })],
    reviews: [
      { id: 3, state: "APPROVED", body: REVIEW_BODY, user: { login: LOGIN }, commit_id: HEAD },
    ],
  });
  const staleResult = await applyPinnedDecision(stale.client, target, {
    login: LOGIN,
    headSha: HEAD,
    baseSha: BASE,
    safe: true,
  });
  assert.equal(staleResult.action, "stale");
  assert.equal(stale.posts.length, 0);
  assert.equal(stale.dismissals.length, 0);

  const raced = snapshot({
    files: [],
    pulls: [pull(), pull({ head: { sha: MOVED } })],
    reviews: [],
  });
  const racedResult = await applyPinnedDecision(raced.client, target, {
    login: LOGIN,
    headSha: HEAD,
    baseSha: BASE,
    safe: true,
  });
  assert.equal(racedResult.approved, false);
  assert.equal(raced.posts.length, 1);
  assert.equal(raced.dismissals.length, 1);

  const human = {
    id: 4,
    state: "APPROVED",
    body: "",
    user: { login: LOGIN },
    commit_id: HEAD,
  };
  const stranger = {
    id: 5,
    state: "APPROVED",
    body: REVIEW_BODY,
    user: { login: "someone[bot]" },
    commit_id: HEAD,
  };
  const own = {
    id: 6,
    state: "APPROVED",
    body: `note\n${AUTO_APPROVE_MARKER}`,
    user: { login: LOGIN },
    commit_id: BASE,
  };
  const unsafe = snapshot({
    files: [],
    pulls: [pull()],
    reviews: [human, stranger, own],
  });
  const unsafeResult = await applyPinnedDecision(unsafe.client, target, {
    login: LOGIN,
    headSha: HEAD,
    baseSha: BASE,
    safe: false,
  });
  assert.equal(unsafeResult.action, "not-approved");
  assert.equal(unsafe.dismissals.length, 1);
  assert.match(unsafe.dismissals[0].message, /no longer limited/);

  const duplicate = snapshot({
    files: [],
    pulls: [pull(), pull()],
    reviews: [own],
  });
  duplicate.client.paginate = async () => [
    { ...own, commit_id: HEAD },
  ];
  const duplicateResult = await applyPinnedDecision(duplicate.client, target, {
    login: LOGIN,
    headSha: HEAD,
    baseSha: BASE,
    safe: true,
  });
  assert.equal(duplicateResult.approved, false);
  assert.equal(duplicate.posts.length, 0);

  await assert.rejects(
    applyPinnedDecision(approved.client, target, {
      login: "not-a-bot",
      headSha: HEAD,
      baseSha: BASE,
      safe: true,
    }),
    /approver bot login/,
  );
});

test("classification failures do not publish a safe decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "comment-approve-"));
  const eventPath = join(dir, "event.json");
  await writeFile(eventPath, JSON.stringify({ pull_request: { number: 7 } }));
  const env = {
    GITHUB_REPOSITORY: "y-writings/window-nest",
    GITHUB_EVENT_PATH: eventPath,
  };
  const broken = {
    async request() {
      throw new Error("api down");
    },
    async paginate() {
      throw new Error("api down");
    },
  };
  const result = await execute("classify", env, broken);
  assert.deepEqual(result.outputs, {
    safe: "false",
    dismiss: "false",
    head_sha: "",
    base_sha: "",
  });
  assert.match(result.reason, /failed closed/);
});

test("follows GitHub pagination links and stops on a repeated page", async () => {
  assert.equal(
    nextLink('<https://example.test/items?page=2>; rel="next"'),
    "https://example.test/items?page=2",
  );
  assert.equal(nextLink(null), null);
  const pages = [
    jsonPage([{ id: 1 }], '<https://example.test/page-2>; rel="next"'),
    jsonPage([{ id: 2 }], null),
  ];
  const client = createClient("token", {
    api: "https://example.test",
    fetch: async () => pages.shift(),
  });
  assert.deepEqual(await client.paginate("/items"), [{ id: 1 }, { id: 2 }]);

  const loop = createClient("token", {
    api: "https://example.test",
    fetch: async () => jsonPage([], '<https://example.test/items?per_page=100>; rel="next"'),
  });
  await assert.rejects(loop.paginate("/items"), /repeated/);
});

test("workflow keeps the comment gate and does not trust the pull request head", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/00-comment-approve.yaml", import.meta.url),
    "utf8",
  );
  const contract = await readFile(new URL("../.driftline/contract.toml", import.meta.url), "utf8");
  assert.match(workflow, /github\.event\.comment\.body == 'approve'/);
  assert.match(workflow, /github\.event\.comment\.user\.login == 'y-writings'/);
  assert.match(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /^ {2}pull_request:/m);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head/);
  assert.doesNotMatch(workflow, /actions\/checkout@[^ \n]+[\s\S]*ref: \$\{\{ github\.event\.pull_request/);
  assert.match(workflow, /node \.github\/scripts\/comment-approve-docs\.mjs classify/);
  assert.match(workflow, /node \.github\/scripts\/comment-approve-docs\.mjs apply/);
  assert.match(workflow, /hmarr\/auto-approve-action@f0939ea97e9205ef24d872e76833fa908a770363/);
  assert.match(
    contract,
    /comment-approve = \{ path = "\.github\/workflows\/00-comment-approve\.yaml", mode = "managed" \}/,
  );
  assert.match(
    contract,
    /comment-approve-docs = \{ path = "\.github\/scripts\/comment-approve-docs\.mjs", mode = "managed" \}/,
  );
});

function jsonPage(body, link) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "link" ? link : null) },
    json: async () => body,
  };
}
