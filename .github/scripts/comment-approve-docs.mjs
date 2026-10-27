// Decides whether a pull request may be approved without an "approve" comment.
//
// PR Diff Lens is not used. It only publishes a Markdown table, groups files by
// suffix using configuration read from the pull request head, and cannot tell
// .github/workflows apart from other YAML. An over-long diff is reported as
// unavailable rather than as a decision. This module keeps a fixed allowlist
// and treats anything unrecognized as requiring the comment.

import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const AUTO_APPROVE_MARKER = "<!-- docs-config-auto-approve -->";

export const REVIEW_BODY = [
  "Automated approval because every changed file is documentation or non-executable configuration.",
  AUTO_APPROVE_MARKER,
].join("\n");

const DISMISS_STALE_MESSAGE =
  "Dismissed because the pull request changed before this documentation approval could apply.";

const DISMISS_UNSAFE_MESSAGE =
  "Dismissed because this pull request is no longer limited to documentation or non-executable configuration.";

const DOC_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".rst",
  ".adoc",
  ".asciidoc",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

const DOC_BASENAMES = new Set([
  "license",
  "license.md",
  "license.txt",
  "copying",
  "copying.md",
  "notice",
  "notice.md",
  "notice.txt",
  "authors",
  "authors.md",
  "changelog",
  "changelog.md",
  "contributors",
  "contributors.md",
]);

const CONFIG_BASENAMES = new Set([
  ".editorconfig",
  ".gitignore",
  ".prettierignore",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.toml",
  ".markdownlint.json",
  ".markdownlint.yaml",
  ".markdownlint.yml",
  ".markdownlint-cli2.jsonc",
  ".markdownlint-cli2.yaml",
  ".markdownlintrc",
  "tombi.toml",
  "cliff.toml",
  ".pinact.yaml",
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yml",
  ".commitlintrc.yaml",
  "jsconfig.json",
  "biome.json",
  "biome.jsonc",
  ".yamllint",
  ".yamllint.yml",
  ".yamllint.yaml",
]);

const EXACT_CONFIG_PATHS = new Set([
  ".github/pr-diff-groups.json",
  ".github/FUNDING.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/DISCUSSION_TEMPLATE/config.yml",
]);

const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".ksh",
  ".fish",
  ".ps1",
  ".psm1",
  ".bat",
  ".cmd",
  ".py",
  ".pyw",
  ".rb",
  ".pl",
  ".pm",
  ".php",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".cs",
  ".fs",
  ".vb",
  ".scala",
  ".groovy",
  ".lua",
  ".dart",
  ".ex",
  ".exs",
  ".clj",
  ".hs",
  ".ml",
  ".r",
  ".jl",
]);

const UNSAFE_BASENAMES = new Set([
  "action.yml",
  "action.yaml",
  "dockerfile",
  "containerfile",
  "makefile",
  "gnumakefile",
  "justfile",
  "jenkinsfile",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "go.mod",
  "go.sum",
  "cargo.toml",
  "cargo.lock",
  "pyproject.toml",
  "pipfile",
  "pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "gemfile",
  "gemfile.lock",
  "composer.json",
  "composer.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "flake.nix",
  "flake.lock",
  "default.nix",
  "shell.nix",
  "cmakelists.txt",
  "meson.build",
  "lefthook.yml",
  "lefthook.yaml",
  "procfile",
  "codeowners",
  "dependabot.yml",
  "dependabot.yaml",
  "renovate.json",
  "renovate.json5",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "taskfile.yml",
  "taskfile.yaml",
  "mix.exs",
  "pubspec.yaml",
  "pubspec.lock",
  "package.swift",
  "module.bazel",
  "workspace",
  "workspace.bazel",
  ".gitlab-ci.yml",
  ".travis.yml",
  "appveyor.yml",
  "azure-pipelines.yml",
  "netlify.toml",
  "vercel.json",
  "fly.toml",
  "render.yaml",
  "mise.toml",
  ".mise.toml",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".tool-versions",
  "release-please-config.json",
  ".release-please-manifest.json",
]);

const UNSAFE_EXTENSIONS = new Set([".lock", ".nix", ".gemspec", ".csproj", ".fsproj", ".sln"]);

const KNOWN_STATUSES = new Set([
  "added",
  "removed",
  "modified",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);

export function pathDecision(path) {
  if (!isValidPath(path)) {
    return { ok: false, reason: "a changed path is invalid" };
  }
  if (isWorkflowOrActionPath(path)) {
    return { ok: false, reason: `${path} is in a workflow or action directory` };
  }
  if (isAllowlisted(path)) return { ok: true, reason: "" };
  const known = knownUnsafeReason(path);
  if (known) return { ok: false, reason: `${path} ${known}` };
  return {
    ok: false,
    reason: `${path} is not documentation or non-executable configuration`,
  };
}

export function classify(files, headEntries, baseEntries) {
  if (!Array.isArray(files) || files.length === 0) {
    return { safe: false, reason: "pull request does not change any file" };
  }
  for (const file of files) {
    const status = file?.status;
    const path = file?.filename;
    if (!isValidPath(path)) {
      return { safe: false, reason: "a changed path is invalid" };
    }
    if (!KNOWN_STATUSES.has(status)) {
      return { safe: false, reason: `${path} has an unrecognized change status` };
    }
    if (status === "removed") {
      const base = regularAllowlisted(path, baseEntries, "base");
      if (!base.ok) return { safe: false, reason: base.reason };
      continue;
    }
    if (status === "renamed" || status === "copied") {
      const previous = file.previous_filename;
      if (!isValidPath(previous)) {
        return { safe: false, reason: `${path} is missing its previous path` };
      }
      const head = regularAllowlisted(path, headEntries, "head");
      if (!head.ok) return { safe: false, reason: head.reason };
      const base = regularAllowlisted(previous, baseEntries, "base");
      if (!base.ok) return { safe: false, reason: base.reason };
      continue;
    }
    const head = regularAllowlisted(path, headEntries, "head");
    if (!head.ok) return { safe: false, reason: head.reason };
    if (status !== "added") {
      const base = regularAllowlisted(path, baseEntries, "base");
      if (!base.ok) return { safe: false, reason: base.reason };
      continue;
    }
    const replaced = baseEntries.get(path);
    if (
      replaced &&
      (replaced.type !== "blob" || String(replaced.mode) !== "100644")
    ) {
      return {
        safe: false,
        reason: `${path} replaces a non-regular file on base`,
      };
    }
  }
  return {
    safe: true,
    reason: `all ${files.length} changed file(s) are documentation or non-executable configuration`,
  };
}

export function indexTree(tree) {
  const entries = new Map();
  if (!Array.isArray(tree)) return entries;
  for (const entry of tree) {
    if (entry && typeof entry.path === "string") entries.set(entry.path, entry);
  }
  return entries;
}

export async function evaluate(client, target) {
  const before = await client.request("GET", pullsPath(target));
  const headSha = shaOf(before?.head?.sha);
  const baseSha = shaOf(before?.base?.sha);
  if (before?.state !== "open" || !headSha || !baseSha) {
    return {
      safe: false,
      dismiss: false,
      reason: "pull request is not an open request with commit SHAs",
      headSha: headSha ?? "",
      baseSha: baseSha ?? "",
    };
  }
  const files = await client.paginate(filesPath(target));
  if (
    !Number.isSafeInteger(before.changed_files) ||
    before.changed_files < 1 ||
    !Array.isArray(files) ||
    files.length !== before.changed_files
  ) {
    return {
      safe: false,
      dismiss: await hasMarkerApproval(client, target),
      reason: "changed file list is incomplete or inconsistent",
      headSha,
      baseSha,
    };
  }
  let headTree;
  let baseTree;
  try {
    headTree = await loadTree(client, target, headSha);
    baseTree = await loadTree(client, target, baseSha);
  } catch {
    return {
      safe: false,
      dismiss: await hasMarkerApproval(client, target),
      reason: "git tree metadata is unavailable",
      headSha,
      baseSha,
    };
  }
  if (headTree.truncated || baseTree.truncated) {
    return {
      safe: false,
      dismiss: await hasMarkerApproval(client, target),
      reason: "git tree is truncated",
      headSha,
      baseSha,
    };
  }
  const after = await client.request("GET", pullsPath(target));
  if (
    shaOf(after?.head?.sha) !== headSha ||
    shaOf(after?.base?.sha) !== baseSha ||
    after?.changed_files !== before.changed_files
  ) {
    return {
      safe: false,
      dismiss: await hasMarkerApproval(client, target),
      reason: "pull request changed while it was being classified",
      headSha,
      baseSha,
    };
  }
  const decision = classify(
    files,
    indexTree(headTree.tree),
    indexTree(baseTree.tree),
  );
  return {
    safe: decision.safe,
    dismiss: decision.safe ? false : await hasMarkerApproval(client, target),
    reason: decision.reason,
    headSha,
    baseSha,
  };
}

export async function applyPinnedDecision(client, target, pin) {
  const headSha = shaOf(pin.headSha);
  const baseSha = shaOf(pin.baseSha);
  const login = typeof pin.login === "string" ? pin.login : "";
  if (!headSha || !baseSha) {
    throw new Error("refusing to update reviews without pinned commit SHAs");
  }
  if (!/^[A-Za-z0-9-]+\[bot\]$/.test(login)) {
    throw new Error("refusing to update reviews without the approver bot login");
  }
  const pull = await client.request("GET", pullsPath(target));
  if (
    pull?.state !== "open" ||
    shaOf(pull?.head?.sha) !== headSha ||
    shaOf(pull?.base?.sha) !== baseSha
  ) {
    // A newer commit has its own run. Dismissing here can race with that run
    // and remove an approval it just submitted.
    return {
      action: "stale",
      dismissed: 0,
      reason: "pull request changed before the pinned decision could be applied",
    };
  }
  if (pin.safe === true) {
    const approved = await approvePinned(client, target, login, headSha, baseSha);
    return { action: approved.approved ? "approved" : "unchanged", ...approved };
  }
  const dismissed = await dismissMarkedApprovals(client, target, login);
  return {
    action: "not-approved",
    dismissed,
    reason: "classification does not allow automatic approval",
  };
}

export function createClient(token, options = {}) {
  const api = (options.api ?? "https://api.github.com").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  async function send(method, url, body) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const error = new Error(
        `${method} ${url} failed with ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }
  return {
    request(method, path, body) {
      return send(method, `${api}${path}`, body);
    },
    async paginate(path) {
      const items = [];
      let url = `${api}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
      const seen = new Set();
      while (url) {
        if (seen.has(url)) throw new Error("pagination repeated a page");
        seen.add(url);
        const response = await fetchImpl(url, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!response.ok) {
          const error = new Error(`GET ${url} failed with ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const page = await response.json();
        if (!Array.isArray(page)) throw new Error("paginated response was not a list");
        items.push(...page);
        url = nextLink(response.headers.get("link"));
      }
      return items;
    },
  };
}

export function nextLink(header) {
  if (typeof header !== "string") return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

export async function execute(mode, env, client) {
  const target = targetFrom(env);
  if (mode === "classify") {
    try {
      const decision = await evaluate(client, target);
      return { outputs: publicDecision(decision), reason: decision.reason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        outputs: { safe: "false", dismiss: "false", head_sha: "", base_sha: "" },
        reason: `classification failed closed: ${message}`,
      };
    }
  }
  if (mode === "apply") {
    const result = await applyPinnedDecision(client, target, {
      login: env.APPROVER_LOGIN,
      headSha: env.EXPECTED_HEAD_SHA,
      baseSha: env.EXPECTED_BASE_SHA,
      safe: env.CLASSIFICATION_SAFE === "true",
    });
    return { outputs: {}, reason: result.reason ?? result.action, result };
  }
  throw new Error(`unknown mode ${mode}`);
}

function publicDecision(decision) {
  const head = shaOf(decision.headSha) ?? "";
  const base = shaOf(decision.baseSha) ?? "";
  const usable = head !== "" && base !== "";
  return {
    safe: decision.safe && usable ? "true" : "false",
    dismiss: !decision.safe && decision.dismiss && usable ? "true" : "false",
    head_sha: usable ? head : "",
    base_sha: usable ? base : "",
  };
}

function targetFrom(env) {
  const repository = env.GITHUB_REPOSITORY ?? "";
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("GITHUB_REPOSITORY must be owner/repo");
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const pull_number = event?.pull_request?.number;
  if (!Number.isSafeInteger(pull_number) || pull_number < 1) {
    throw new Error("event is missing a pull request number");
  }
  return { owner, repo, pull_number };
}

function writeOutputs(path, outputs) {
  const lines = ["safe", "dismiss", "head_sha", "base_sha"].map((key) => {
    const value = outputs[key] ?? "";
    if (/[\r\n]/.test(value)) throw new Error(`refusing to write unsafe output ${key}`);
    return `${key}=${value}`;
  });
  appendFileSync(path, `${lines.join("\n")}\n`);
}

async function approvePinned(client, target, login, headSha, baseSha) {
  const reviews = await client.paginate(reviewsPath(target));
  const already = reviews.some(
    (review) =>
      review?.user?.login === login &&
      review.state === "APPROVED" &&
      review.commit_id === headSha &&
      typeof review.body === "string" &&
      review.body.includes(AUTO_APPROVE_MARKER),
  );
  if (already) {
    return { approved: false, reason: "this commit already has the documentation approval" };
  }
  const review = await client.request("POST", reviewsPath(target), {
    commit_id: headSha,
    body: REVIEW_BODY,
    event: "APPROVE",
  });
  const after = await client.request("GET", pullsPath(target));
  if (shaOf(after?.head?.sha) !== headSha || shaOf(after?.base?.sha) !== baseSha) {
    await dismissReview(client, target, review.id, DISMISS_STALE_MESSAGE);
    return {
      approved: false,
      reason: "pull request changed after approval; the new review was dismissed",
    };
  }
  return { approved: true, reason: `approved ${headSha}` };
}

async function dismissMarkedApprovals(client, target, login) {
  const reviews = await client.paginate(reviewsPath(target));
  let dismissed = 0;
  for (const review of reviews) {
    if (review?.state !== "APPROVED") continue;
    if (review.user?.login !== login) continue;
    if (typeof review.body !== "string" || !review.body.includes(AUTO_APPROVE_MARKER)) {
      continue;
    }
    await dismissReview(client, target, review.id, DISMISS_UNSAFE_MESSAGE);
    dismissed += 1;
  }
  return dismissed;
}

function dismissReview(client, target, reviewId, message) {
  if (typeof reviewId !== "number" || !Number.isSafeInteger(reviewId)) {
    throw new Error("review id is missing");
  }
  return client.request(
    "PUT",
    `${reviewsPath(target)}/${reviewId}/dismissals`,
    { message, event: "DISMISS" },
  );
}

async function hasMarkerApproval(client, target) {
  const reviews = await client.paginate(reviewsPath(target));
  return reviews.some(
    (review) =>
      review?.state === "APPROVED" &&
      typeof review.body === "string" &&
      review.body.includes(AUTO_APPROVE_MARKER),
  );
}

async function loadTree(client, target, commitSha) {
  const commit = await client.request(
    "GET",
    `${repoPrefix(target)}/git/commits/${commitSha}`,
  );
  const treeSha = shaOf(commit?.tree?.sha);
  if (!treeSha) throw new Error("commit is missing a tree");
  return client.request(
    "GET",
    `${repoPrefix(target)}/git/trees/${treeSha}?recursive=1`,
  );
}

function regularAllowlisted(path, entries, side) {
  const decision = pathDecision(path);
  if (!decision.ok) return decision;
  const entry = entries.get(path);
  if (!entry) return { ok: false, reason: `${path} has no ${side} git entry` };
  if (entry.type !== "blob" || String(entry.mode) !== "100644") {
    return {
      ok: false,
      reason: `${path} is not a regular non-executable file on ${side}`,
    };
  }
  return { ok: true, reason: "" };
}

function isAllowlisted(path) {
  const base = basename(path);
  if (DOC_BASENAMES.has(base.toLowerCase())) return true;
  if (EXACT_CONFIG_PATHS.has(path)) return true;
  if (CONFIG_BASENAMES.has(base)) return true;
  if (/^tsconfig(?:\.[A-Za-z0-9_-]+)?\.json$/.test(base)) return true;
  return DOC_EXTENSIONS.has(extensionOf(base));
}

function knownUnsafeReason(path) {
  const base = basename(path);
  const lower = base.toLowerCase();
  if (lower === "action.yml" || lower === "action.yaml") {
    return "is a GitHub Action definition";
  }
  if (
    /^(?:dockerfile|containerfile|jenkinsfile)(?:\..+)?$/.test(lower) ||
    /^requirements(?:[-_][^/]+)?\.txt$/.test(lower)
  ) {
    return "is a build or CI file";
  }
  if (UNSAFE_BASENAMES.has(lower)) return "is a build, lock, task, or CI file";
  const extension = extensionOf(base);
  if (SCRIPT_EXTENSIONS.has(extension)) return "is executable source";
  if (UNSAFE_EXTENSIONS.has(extension)) return "is a build or lock file";
  return null;
}

function isWorkflowOrActionPath(path) {
  const parts = path.split("/");
  for (let index = 0; index < parts.length - 1; index += 1) {
    const parent = parts[index].toLowerCase();
    const child = parts[index + 1].toLowerCase();
    if (parent === ".github" && (child === "workflows" || child === "actions")) {
      return true;
    }
  }
  return false;
}

function isValidPath(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.length > 1024) return false;
  if (/[\0\r\n\\]/.test(path)) return false;
  if (path.startsWith("/") || path.endsWith("/")) return false;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  return true;
}

function basename(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function extensionOf(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return "";
  return lower.slice(dot);
}

function shaOf(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value) ? value : null;
}

function repoPrefix(target) {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

function pullsPath(target) {
  return `${repoPrefix(target)}/pulls/${target.pull_number}`;
}

function filesPath(target) {
  return `${pullsPath(target)}/files`;
}

function reviewsPath(target) {
  return `${pullsPath(target)}/reviews`;
}

async function main() {
  const mode = process.argv[2];
  const client = createClient(process.env.GITHUB_TOKEN ?? "");
  try {
    const result = await execute(mode, process.env, client);
    if (mode === "classify") writeOutputs(process.env.GITHUB_OUTPUT, result.outputs);
    console.log(result.reason);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode === "classify" && process.env.GITHUB_OUTPUT) {
      writeOutputs(process.env.GITHUB_OUTPUT, {
        safe: "false",
        dismiss: "false",
        head_sha: "",
        base_sha: "",
      });
      console.warn(`classification failed closed: ${message}`);
      return;
    }
    console.error(message);
    process.exitCode = 1;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  await main();
}
