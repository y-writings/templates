import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL(
    "../.github/workflows/00-entire-checkpoint-collection.yaml",
    import.meta.url,
  ),
  "utf8",
);
const marker = "          script: |\n";
const script = workflow
  .slice(workflow.indexOf(marker) + marker.length)
  .split("\n")
  .map((line) => (line.startsWith("            ") ? line.slice(12) : line))
  .join("\n");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function execute({
  body = "",
  latestBody = body,
  commits = [],
  initialSha = ["base", "head"],
  latestSha = initialSha,
}) {
  const updates = [];
  const warnings = [];
  const gets = [
    { body, base: { sha: initialSha[0] }, head: { sha: initialSha[1] } },
    {
      body: latestBody,
      base: { sha: latestSha[0] },
      head: { sha: latestSha[1] },
    },
  ];
  let compared;
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: gets.shift() }),
        update: async (request) => updates.push(request),
      },
      repos: { compareCommitsWithBasehead() {} },
    },
    paginate: async (_method, request) => {
      compared = request.basehead;
      return commits.map((message) => ({ commit: { message } }));
    },
  };
  const core = { info() {}, warning: (message) => warnings.push(message) };
  const context = {
    repo: { owner: "o", repo: "r" },
    payload: {
      pull_request: {
        number: 7,
        base: { sha: "stale-base" },
        head: { sha: "stale-head" },
      },
    },
  };
  await new AsyncFunction("github", "context", "core", script)(
    github,
    context,
    core,
  );
  return { body: updates[0]?.body, updates, warnings, compared };
}

const section = "## Entire checkpoints\n\nEntire-Checkpoint: abc";
const codeIndentations = [
  ["four spaces", "    "],
  ["a tab", "\t"],
];

test("creates a markerless section and skips an unchanged body", async () => {
  const first = await execute({
    commits: ["x\nEntire-Checkpoint: abc\nEntire-Checkpoint: abc"],
  });
  assert.equal(first.updates.length, 1);
  assert.equal(first.body, section);
  const second = await execute({
    body: first.body,
    commits: ["Entire-Checkpoint: abc"],
  });
  assert.equal(second.updates.length, 0);
});

test("replaces a handwritten section and its free-form content through the next H1 or H2", async () => {
  const body =
    "before\n\n## Entire checkpoints\nhandwritten notes\n### nested heading\nmore text\n\n# Later\nkeep\n";
  const result = await execute({ body, commits: ["Entire-Checkpoint: $&new"] });
  assert.equal(result.updates.length, 1);
  assert.equal(
    result.body,
    "before\n\n## Entire checkpoints\n\nEntire-Checkpoint: $&new\n\n# Later\nkeep\n",
  );
});

test("ignores examples in code fences and inline heading text while preserving out-of-scope content", async () => {
  const body = `prefix ## Entire checkpoints text\n\`\`\`md\n## Entire checkpoints\n<!-- example -->\n\`\`\`\n\n## Entire checkpoints\nreplace me\n\n## Other bot\n<!-- bot:start -->\n$&\n<!-- bot:end -->\n`;
  const result = await execute({ body, commits: ["Entire-Checkpoint: new"] });
  assert.equal(result.updates.length, 1);
  assert.equal(
    result.body,
    body.replace(
      "## Entire checkpoints\nreplace me\n\n",
      "## Entire checkpoints\n\nEntire-Checkpoint: new\n\n",
    ),
  );
});

test("preserves CRLF and replaces through end of body with the empty state", async () => {
  const body = `text\r\n\r\n## Entire checkpoints\r\nfree form\r\n`;
  const result = await execute({ body });
  assert.equal(result.updates.length, 1);
  assert.equal(
    result.body,
    "text\r\n\r\n## Entire checkpoints\r\n\r\n_No Entire checkpoints found._",
  );
});

test("diagnoses ambiguous bodies without patching", async () => {
  const inputs = [
    "## Entire checkpoints\na\n\n## Entire checkpoints\nb",
    "```\nunclosed",
  ];
  for (const body of inputs) {
    const result = await execute({ body });
    assert.equal(result.updates.length, 0);
    assert.equal(result.warnings.length, 1);
  }
});

test("uses runtime SHAs, keeps concurrent body edits, and skips stale results", async () => {
  const edited = await execute({
    body: "old",
    latestBody: "edited",
    commits: ["Entire-Checkpoint: z"],
  });
  assert.equal(edited.compared, "base...head");
  assert.equal(edited.updates.length, 1);
  assert.equal(
    edited.body,
    "edited\n\n## Entire checkpoints\n\nEntire-Checkpoint: z",
  );
  const stale = await execute({
    body: "old",
    latestBody: "edited",
    latestSha: ["base", "new-head"],
  });
  assert.equal(stale.updates.length, 0);
  assert.match(stale.warnings[0], /changed/);
});

test("preserves indented code examples when adding a section", async () => {
  for (const [label, indent] of codeIndentations) {
    const body = `before\n\n${indent}## Entire checkpoints\n${indent}sample checkpoint`;
    const first = await execute({ body, commits: ["Entire-Checkpoint: abc"] });
    assert.equal(first.updates.length, 1, label);
    assert.equal(first.body, `${body}\n\n${section}`, label);
    assert.deepEqual(first.warnings, [], label);
    const second = await execute({
      body: first.body,
      commits: ["Entire-Checkpoint: abc"],
    });
    assert.equal(second.updates.length, 0, label);
    assert.deepEqual(second.warnings, [], label);
  }
});

test("updates a three-space heading beside indented code and preserves the next heading", async () => {
  for (const [label, indent] of codeIndentations) {
    const prefix = `before\n\n${indent}## Entire checkpoints\n${indent}sample checkpoint\n\n`;
    const suffix = "   ## Next\nkeep\n";
    const body = `${prefix}   ## Entire checkpoints\nreplace me\n\n${suffix}`;
    const result = await execute({ body, commits: ["Entire-Checkpoint: abc"] });
    assert.equal(result.updates.length, 1, label);
    assert.equal(result.body, `${prefix}${section}\n\n${suffix}`, label);
    assert.deepEqual(result.warnings, [], label);
  }
});
