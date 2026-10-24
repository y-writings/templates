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

const boundary =
  "<!-- AUTO-GENERATED METADATA: DO NOT EDIT BELOW THIS LINE -->";
const section = "## Entire checkpoints\n\nEntire-Checkpoint: abc";

test("creates a markerless section without adding a metadata boundary and is idempotent", async () => {
  const first = await execute({
    commits: ["x\nEntire-Checkpoint: abc\nEntire-Checkpoint: abc"],
  });
  assert.equal(first.body, section);
  assert.doesNotMatch(
    first.body,
    /entire-checkpoints:(?:start|end)|AUTO-GENERATED METADATA/,
  );
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
  assert.equal(
    result.body,
    "before\n\n## Entire checkpoints\n\nEntire-Checkpoint: $&new\n\n# Later\nkeep\n",
  );
});

test("finds the section after the shared comment and does not duplicate it when that comment is removed", async () => {
  const withBoundary = `${boundary}\n\n## Entire checkpoints\n\nEntire-Checkpoint: old`;
  const first = await execute({
    body: withBoundary,
    commits: ["Entire-Checkpoint: abc"],
  });
  assert.equal(first.body, `${boundary}\n\n${section}`);
  const withoutBoundary = first.body.replace(`${boundary}\n\n`, "");
  const second = await execute({
    body: withoutBoundary,
    commits: ["Entire-Checkpoint: abc"],
  });
  assert.equal(second.updates.length, 0);
  assert.equal(withoutBoundary.match(/## Entire checkpoints/g).length, 1);
});

test("ignores examples in code fences and inline heading text while preserving out-of-scope content", async () => {
  const body = `prefix ## Entire checkpoints text\n\`\`\`md\n## Entire checkpoints\n${boundary}\n\`\`\`\n\n## Entire checkpoints\nreplace me\n\n## Other bot\n<!-- bot:start -->\n$&\n<!-- bot:end -->\n`;
  const result = await execute({ body, commits: ["Entire-Checkpoint: new"] });
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
  assert.equal(
    result.body,
    "text\r\n\r\n## Entire checkpoints\r\n\r\n_No Entire checkpoints found._",
  );
});

test("migrates recognized legacy output without adding or requiring a shared boundary", async () => {
  for (const prefix of ["manual\n\n", `manual\n\n${boundary}\n\n`]) {
    const legacy =
      "<!-- entire-checkpoints:start -->\n## Entire checkpoints\n\nEntire-Checkpoint: old\n<!-- entire-checkpoints:end -->";
    const result = await execute({
      body: prefix + legacy + "\nkept",
      commits: ["Entire-Checkpoint: new"],
    });
    assert.equal(
      result.body,
      prefix + "## Entire checkpoints\n\nEntire-Checkpoint: new\nkept",
    );
    assert.doesNotMatch(result.body, /entire-checkpoints:(?:start|end)/);
  }
});

test("diagnoses ambiguous bodies without patching", async () => {
  const inputs = [
    "<!-- entire-checkpoints:start -->\n## Entire checkpoints\n\nEntire-Checkpoint: a",
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
  assert.match(edited.body, /^edited/);
  const stale = await execute({
    body: "old",
    latestBody: "edited",
    latestSha: ["base", "new-head"],
  });
  assert.equal(stale.updates.length, 0);
  assert.match(stale.warnings[0], /changed/);
});
