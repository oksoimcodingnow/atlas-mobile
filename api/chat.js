// ATLAS Mobile — /api/chat
// Streams Claude responses back to the browser via SSE.
// Claude has GitHub tools so it can read, edit, and commit code in your repos.
//
// Required env vars (set in .env.local for dev, Vercel dashboard for prod):
//   ANTHROPIC_API_KEY  — from console.anthropic.com
//   GITHUB_TOKEN       — PAT with `repo` scope from github.com/settings/tokens
//   GITHUB_USER        — your GitHub username (default repo owner)

const Anthropic = require("@anthropic-ai/sdk").default;
const { Octokit } = require("@octokit/rest");

const SYSTEM_PROMPT = `You are ATLAS — a mobile AI coding agent. You're talking to the user from their phone.

You can read, edit, and commit code in the user's GitHub repos using the tools below. Always:
- Confirm understanding briefly before doing destructive things
- After making code changes, commit them with a clear message
- Keep responses short and mobile-friendly (no walls of text)
- Use the tools rather than describing what someone should do manually

If the user references a repo without owner (e.g. "roshop"), assume it's the default user's repo.`;

const TOOLS = [
  {
    name: "list_repo_files",
    description: "List files in a GitHub repository at a given path. Use this to explore the repo structure before reading specific files.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repo in 'owner/name' format. If only 'name' is given, assume the default user." },
        path: { type: "string", description: "Folder path inside the repo. Empty string for repo root." },
        ref: { type: "string", description: "Branch or commit. Defaults to the repo's default branch." }
      },
      required: ["repo", "path"]
    }
  },
  {
    name: "read_repo_file",
    description: "Read the full content of a single file from a GitHub repository.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        path: { type: "string", description: "File path inside the repo." },
        ref: { type: "string", description: "Branch or commit. Defaults to the repo's default branch." }
      },
      required: ["repo", "path"]
    }
  },
  {
    name: "write_repo_file",
    description: "Create or overwrite a file in a GitHub repository and commit the change. The commit is pushed automatically.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        path: { type: "string", description: "File path inside the repo." },
        content: { type: "string", description: "Full new file content." },
        commit_message: { type: "string", description: "Concise commit message describing the change." },
        branch: { type: "string", description: "Branch to commit to. Defaults to the repo's default branch." }
      },
      required: ["repo", "path", "content", "commit_message"]
    }
  }
];

function normalizeRepo(repo, defaultUser) {
  if (!repo) return null;
  if (repo.includes("/")) {
    const [owner, name] = repo.split("/");
    return { owner, repo: name };
  }
  return { owner: defaultUser, repo };
}

async function runTool(toolName, input, octokit, defaultUser) {
  const target = normalizeRepo(input.repo, defaultUser);
  if (!target) throw new Error("Missing repo");
  const { owner, repo } = target;

  if (toolName === "list_repo_files") {
    const { data } = await octokit.repos.getContent({
      owner, repo, path: input.path || "", ref: input.ref,
    });
    const entries = Array.isArray(data) ? data : [data];
    const items = entries.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size }));
    return {
      content: JSON.stringify(items, null, 2),
      summary: `listed ${items.length} entries in ${owner}/${repo}/${input.path || ""}`,
    };
  }

  if (toolName === "read_repo_file") {
    const { data } = await octokit.repos.getContent({
      owner, repo, path: input.path, ref: input.ref,
    });
    if (Array.isArray(data)) throw new Error(`${input.path} is a folder, not a file`);
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return {
      content,
      summary: `read ${owner}/${repo}/${input.path} (${content.length} chars)`,
    };
  }

  if (toolName === "write_repo_file") {
    // get current SHA if file exists (needed for update)
    let sha;
    try {
      const { data } = await octokit.repos.getContent({
        owner, repo, path: input.path, ref: input.branch,
      });
      if (!Array.isArray(data)) sha = data.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    const { data } = await octokit.repos.createOrUpdateFileContents({
      owner, repo, path: input.path,
      message: input.commit_message,
      content: Buffer.from(input.content, "utf-8").toString("base64"),
      sha,
      branch: input.branch,
    });

    return {
      content: `committed ${data.commit.sha.slice(0, 7)}`,
      summary: `committed ${owner}/${repo}/${input.path} — "${input.commit_message}"`,
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" });
    return;
  }
  if (!process.env.GITHUB_TOKEN) {
    res.status(500).json({ error: "Server missing GITHUB_TOKEN" });
    return;
  }

  const { messages = [], model = "claude-opus-4-7", repo } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const defaultUser = process.env.GITHUB_USER || "";

  const fullSystem = [
    {
      type: "text",
      text:
        SYSTEM_PROMPT +
        `\n\nDefault GitHub user: ${defaultUser}` +
        (repo ? `\nUser's current repo context: ${repo}` : ""),
      cache_control: { type: "ephemeral" },
    },
  ];

  // working copy of messages — we mutate it across tool-use turns
  let workMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  try {
    // agentic loop: repeat until end_turn
    for (let iteration = 0; iteration < 10; iteration++) {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: 4096,
        system: fullSystem,
        tools: TOOLS,
        messages: workMessages,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta &&
          event.delta.type === "text_delta"
        ) {
          sse(res, { type: "text", text: event.delta.text });
        }
      }

      const finalMsg = await stream.finalMessage();
      // record assistant turn
      workMessages.push({ role: "assistant", content: finalMsg.content });

      if (finalMsg.stop_reason !== "tool_use") {
        sse(res, { type: "done" });
        break;
      }

      // execute every tool_use block in this turn
      const toolUses = finalMsg.content.filter((b) => b.type === "tool_use");
      const toolResults = [];

      for (const tu of toolUses) {
        sse(res, { type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
        try {
          const result = await runTool(tu.name, tu.input, octokit, defaultUser);
          sse(res, { type: "tool_result", id: tu.id, is_error: false, summary: result.summary });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result.content,
          });
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          sse(res, { type: "tool_result", id: tu.id, is_error: true, summary: msg });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: "Error: " + msg,
            is_error: true,
          });
        }
      }

      workMessages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    sse(res, { type: "error", message: msg });
  }

  res.end();
};
