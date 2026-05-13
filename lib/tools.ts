/**
 * SHARED TOOLS — used by both Anthropic and Gemini providers.
 * ===========================================================
 * Both AIs talk to GitHub the same way through Octokit. The only thing
 * that differs is HOW each provider describes the tool to the model
 * (different JSON shapes for tool definitions). Execution is identical.
 *
 * Each tool returns:
 *   - `content`: the actual data to feed back to the model
 *   - `summary`: a one-line human-readable description for the UI
 */
import { Octokit } from "@octokit/rest";

export interface ToolInput {
  repo?: string;
  path?: string;
  ref?: string;
  branch?: string;
  content?: string;
  commit_message?: string;
}

export interface ToolResult {
  content: string;
  summary: string;
}

// JSON Schema describing each tool's inputs. We feed this in slightly
// different shapes to each provider, but the schema itself is the same.
export const TOOL_SCHEMAS = [
  {
    name: "list_repo_files",
    description:
      "List files in a GitHub repository at a given path. Use this to explore the repo structure before reading specific files.",
    parameters: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string" as const,
          description:
            "Repo in 'owner/name' format. If only 'name' is given, the default user is used.",
        },
        path: {
          type: "string" as const,
          description: "Folder path inside the repo. Empty string for repo root.",
        },
        ref: {
          type: "string" as const,
          description: "Branch or commit. Defaults to the repo's default branch.",
        },
      },
      required: ["repo", "path"],
    },
  },
  {
    name: "read_repo_file",
    description: "Read the full content of a single file from a GitHub repository.",
    parameters: {
      type: "object" as const,
      properties: {
        repo: { type: "string" as const },
        path: { type: "string" as const, description: "File path inside the repo." },
        ref: { type: "string" as const, description: "Branch or commit." },
      },
      required: ["repo", "path"],
    },
  },
  {
    name: "write_repo_file",
    description:
      "Create or overwrite a file in a GitHub repository and commit the change. The commit is pushed automatically.",
    parameters: {
      type: "object" as const,
      properties: {
        repo: { type: "string" as const },
        path: { type: "string" as const, description: "File path inside the repo." },
        content: { type: "string" as const, description: "Full new file content." },
        commit_message: {
          type: "string" as const,
          description: "Concise commit message describing the change.",
        },
        branch: {
          type: "string" as const,
          description: "Branch to commit to. Defaults to the repo's default branch.",
        },
      },
      required: ["repo", "path", "content", "commit_message"],
    },
  },
];

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

export async function runTool(
  toolName: string,
  input: ToolInput,
  octokit: Octokit,
  defaultUser: string,
): Promise<ToolResult> {
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

export const SYSTEM_PROMPT = `You are ATLAS — a mobile AI coding agent. You're talking to the user from their phone.

You can read, edit, and commit code in the user's GitHub repos using the tools below. Always:
- Confirm understanding briefly before doing destructive things
- After making code changes, commit them with a clear message
- Keep responses short and mobile-friendly (no walls of text)
- Use the tools rather than describing what someone should do manually

If the user references a repo without an owner (e.g. "roshop"), assume it's the default user's repo.`;

// Helper for SSE-formatted output. Both providers write the same event shape.
export function sseChunk(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}
