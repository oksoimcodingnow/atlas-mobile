/**
 * /api/chat — Next.js Route Handler
 * =================================
 *
 * NEXT.JS 101:
 *
 * In the App Router, any file named `route.ts` (or .js) inside the `app/`
 * folder becomes a SERVER-SIDE endpoint. The folder structure determines
 * the URL:
 *
 *   app/api/chat/route.ts   ->   /api/chat
 *
 * Export a named function for each HTTP method you want to handle:
 *
 *   export async function GET(request)  { ... }
 *   export async function POST(request) { ... }
 *
 * These functions run on the SERVER (Node.js on Vercel), so we can safely
 * use API keys and tokens here — they NEVER reach the browser.
 *
 * The function receives a standard Web API `Request` and returns a `Response`.
 * For streaming, we return a `Response` whose body is a `ReadableStream`,
 * and we write Server-Sent Events (SSE) into that stream.
 *
 *
 * AGENTIC LOOP:
 *
 * Claude has 3 tools defined below (list_repo_files, read_repo_file,
 * write_repo_file). When the user asks something like "fix the bug in
 * roshop's index.html", Claude will:
 *
 *   1. Decide to call `list_repo_files` to find the file
 *   2. Call `read_repo_file` to see the contents
 *   3. Call `write_repo_file` with the fix (commits + pushes to GitHub)
 *
 * Each tool call is one round trip:
 *   browser -> /api/chat -> Claude -> {wants to call tool} -> our code
 *     runs the tool against GitHub API -> result fed back to Claude
 *     -> Claude replies or calls another tool
 *
 * We loop until Claude says "end_turn" (no more tools to call). Capped
 * at 10 iterations to prevent runaway loops.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";

// Tell Next.js this route uses Node.js (not Edge runtime) and may run
// long. Default is 10s on Vercel Hobby — bumping to 60s for safety.
export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// SYSTEM PROMPT + TOOL DEFINITIONS
// ============================================================================

const SYSTEM_PROMPT = `You are ATLAS — a mobile AI coding agent. You're talking to the user from their phone.

You can read, edit, and commit code in the user's GitHub repos using the tools below. Always:
- Confirm understanding briefly before doing destructive things
- After making code changes, commit them with a clear message
- Keep responses short and mobile-friendly (no walls of text)
- Use the tools rather than describing what someone should do manually

If the user references a repo without an owner (e.g. "roshop"), assume it's the default user's repo.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_repo_files",
    description:
      "List files in a GitHub repository at a given path. Use this to explore the repo structure before reading specific files.",
    input_schema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description:
            "Repo in 'owner/name' format. If only 'name' is given, assume the default user.",
        },
        path: {
          type: "string",
          description: "Folder path inside the repo. Empty string for repo root.",
        },
        ref: {
          type: "string",
          description: "Branch or commit. Defaults to the repo's default branch.",
        },
      },
      required: ["repo", "path"],
    },
  },
  {
    name: "read_repo_file",
    description: "Read the full content of a single file from a GitHub repository.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        path: { type: "string", description: "File path inside the repo." },
        ref: { type: "string", description: "Branch or commit." },
      },
      required: ["repo", "path"],
    },
  },
  {
    name: "write_repo_file",
    description:
      "Create or overwrite a file in a GitHub repository and commit the change. The commit is pushed automatically.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        path: { type: "string", description: "File path inside the repo." },
        content: { type: "string", description: "Full new file content." },
        commit_message: {
          type: "string",
          description: "Concise commit message describing the change.",
        },
        branch: {
          type: "string",
          description: "Branch to commit to. Defaults to the repo's default branch.",
        },
      },
      required: ["repo", "path", "content", "commit_message"],
    },
  },
];

// ============================================================================
// TOOL EXECUTION
// ============================================================================

function normalizeRepo(
  repo: string | undefined,
  defaultUser: string,
): { owner: string; repo: string } | null {
  if (!repo) return null;
  if (repo.includes("/")) {
    const [owner, name] = repo.split("/");
    return { owner, repo: name };
  }
  return { owner: defaultUser, repo };
}

type ToolInput = {
  repo?: string;
  path?: string;
  ref?: string;
  branch?: string;
  content?: string;
  commit_message?: string;
};

async function runTool(
  toolName: string,
  input: ToolInput,
  octokit: Octokit,
  defaultUser: string,
): Promise<{ content: string; summary: string }> {
  const target = normalizeRepo(input.repo, defaultUser);
  if (!target) throw new Error("Missing repo");
  const { owner, repo } = target;

  if (toolName === "list_repo_files") {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: input.path || "",
      ref: input.ref,
    });
    const entries = Array.isArray(data) ? data : [data];
    const items = entries.map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
      size: "size" in e ? e.size : undefined,
    }));
    return {
      content: JSON.stringify(items, null, 2),
      summary: `listed ${items.length} entries in ${owner}/${repo}/${input.path || ""}`,
    };
  }

  if (toolName === "read_repo_file") {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: input.path!,
      ref: input.ref,
    });
    if (Array.isArray(data)) throw new Error(`${input.path} is a folder, not a file`);
    if (!("content" in data)) throw new Error(`${input.path} has no content`);
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return {
      content,
      summary: `read ${owner}/${repo}/${input.path} (${content.length} chars)`,
    };
  }

  if (toolName === "write_repo_file") {
    // Get current SHA if file exists (required for updates).
    let sha: string | undefined;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: input.path!,
        ref: input.branch,
      });
      if (!Array.isArray(data) && "sha" in data) sha = data.sha;
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err.status !== 404) throw e;
    }

    const { data } = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: input.path!,
      message: input.commit_message!,
      content: Buffer.from(input.content!, "utf-8").toString("base64"),
      sha,
      branch: input.branch,
    });

    const sha7 = data.commit.sha?.slice(0, 7) ?? "?";
    return {
      content: `committed ${sha7}`,
      summary: `committed ${owner}/${repo}/${input.path} — "${input.commit_message}"`,
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

// ============================================================================
// SSE HELPER
// ============================================================================

/**
 * Encodes a value as a Server-Sent Event chunk. Each event must end with
 * a double newline (\n\n) — that's how the browser knows one event is done.
 */
function sse(controller: ReadableStreamDefaultController, data: unknown) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// ============================================================================
// THE HANDLER
// ============================================================================

export async function POST(request: Request) {
  // Validate env vars at request time, return clean error if missing.
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("Server missing ANTHROPIC_API_KEY", { status: 500 });
  }
  if (!process.env.GITHUB_TOKEN) {
    return new Response("Server missing GITHUB_TOKEN", { status: 500 });
  }

  const body = (await request.json()) as {
    messages?: Anthropic.MessageParam[];
    model?: string;
    repo?: string;
  };
  const {
    messages = [],
    model = "claude-opus-4-7",
    repo,
  } = body;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const defaultUser = process.env.GITHUB_USER || "";

  // System prompt with prompt caching for efficient repeat calls.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text:
        SYSTEM_PROMPT +
        `\n\nDefault GitHub user: ${defaultUser}` +
        (repo ? `\nUser's current repo context: ${repo}` : ""),
      cache_control: { type: "ephemeral" },
    },
  ];

  // Working copy of the conversation — we mutate this as tools run.
  let workMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Build the SSE stream. The ReadableStream constructor takes a `start`
  // function where you do the streaming work via `controller.enqueue()`.
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let iter = 0; iter < 10; iter++) {
          const claudeStream = anthropic.messages.stream({
            model,
            max_tokens: 4096,
            system: systemBlocks,
            tools: TOOLS,
            messages: workMessages,
          });

          // Forward each text delta from Claude to the browser as it streams.
          for await (const event of claudeStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              sse(controller, { type: "text", text: event.delta.text });
            }
          }

          const finalMsg = await claudeStream.finalMessage();
          workMessages.push({ role: "assistant", content: finalMsg.content });

          if (finalMsg.stop_reason !== "tool_use") {
            sse(controller, { type: "done" });
            break;
          }

          // Execute every tool_use block in this turn.
          const toolUses = finalMsg.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tu of toolUses) {
            sse(controller, {
              type: "tool_use",
              id: tu.id,
              name: tu.name,
              input: tu.input,
            });
            try {
              const result = await runTool(
                tu.name,
                tu.input as ToolInput,
                octokit,
                defaultUser,
              );
              sse(controller, {
                type: "tool_result",
                id: tu.id,
                is_error: false,
                summary: result.summary,
              });
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: result.content,
              });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              sse(controller, {
                type: "tool_result",
                id: tu.id,
                is_error: true,
                summary: msg,
              });
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sse(controller, { type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
