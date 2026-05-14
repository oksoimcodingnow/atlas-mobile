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
import { addReminder, listAllReminders, removeReminder } from "./storage";

export interface ToolInput {
  repo?: string;
  path?: string;
  ref?: string;
  branch?: string;
  content?: string;
  commit_message?: string;
  // schedule_reminder
  fire_at?: string;       // ISO 8601 datetime (absolute)
  delay_seconds?: number; // OR seconds from now (relative — prefer this for "in 5 minutes")
  message?: string;
  // cancel_reminder
  reminder_id?: string;
}

export interface ToolContext {
  octokit: Octokit;
  defaultUser: string;
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
  {
    name: "list_reminders",
    description:
      "List all the user's pending reminders. Use this when the user asks 'what reminders do I have?', 'show me my reminders', or 'when will I get reminded?'. Returns id, fire_at, and message for each.",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "cancel_reminder",
    description:
      "Cancel a previously scheduled reminder by its ID. Use this when the user says 'cancel my reminder', 'don't remind me about X', etc. If you don't know the ID, call list_reminders first to find it.",
    parameters: {
      type: "object" as const,
      properties: {
        reminder_id: {
          type: "string" as const,
          description: "The reminder ID returned from schedule_reminder or list_reminders (looks like 'rem_abc123').",
        },
      },
      required: ["reminder_id"],
    },
  },
  {
    name: "schedule_reminder",
    description:
      "Schedule a future push notification on the user's phone. PREFER `delay_seconds` for relative times like 'in 5 minutes' or 'in 2 hours' — the server computes the exact time, so you don't have to do timezone math (which LLMs are bad at). Only use `fire_at` for absolute clock times like '7pm tomorrow' or 'midnight on Friday'.",
    parameters: {
      type: "object" as const,
      properties: {
        delay_seconds: {
          type: "string" as const,
          description:
            "Seconds from NOW until the reminder fires. Use this for any 'in X minutes/hours/seconds' phrasing. Example: '15' for '15 seconds', '300' for '5 minutes', '7200' for '2 hours'. Pass as a string of digits.",
        },
        fire_at: {
          type: "string" as const,
          description:
            "ISO 8601 datetime for absolute times like '7pm tomorrow'. Include timezone offset. Example: '2026-05-14T19:00:00+07:00'. Use delay_seconds instead if possible.",
        },
        message: {
          type: "string" as const,
          description: "Short notification body (under 100 chars). Becomes the push body.",
        },
      },
      required: ["message"],
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
  ctx: ToolContext,
): Promise<ToolResult> {
  const { octokit, defaultUser } = ctx;

  // list_reminders — show all pending reminders sorted by fire time.
  if (toolName === "list_reminders") {
    const all = await listAllReminders();
    const upcoming = all
      .filter((r) => r.fireAt > Date.now() - 60_000) // skip already-due (cron will pick up)
      .sort((a, b) => a.fireAt - b.fireAt);
    if (upcoming.length === 0) {
      return { content: "[]", summary: "no pending reminders" };
    }
    const formatted = upcoming.map((r) => {
      const secsAway = Math.round((r.fireAt - Date.now()) / 1000);
      const human =
        secsAway < 120 ? `in ${secsAway}s` :
        secsAway < 7200 ? `in ${Math.round(secsAway / 60)}min` :
        new Date(r.fireAt).toISOString();
      return {
        id: r.id,
        fire_at: new Date(r.fireAt).toISOString(),
        fire_at_local: new Date(r.fireAt).toString(),
        in: human,
        message: r.message,
      };
    });
    return {
      content: JSON.stringify(formatted, null, 2),
      summary: `${upcoming.length} pending reminder${upcoming.length === 1 ? "" : "s"}`,
    };
  }

  // cancel_reminder — remove by ID.
  if (toolName === "cancel_reminder") {
    const id = input.reminder_id;
    if (!id) throw new Error("cancel_reminder: missing reminder_id");
    await removeReminder(id);
    return {
      content: JSON.stringify({ canceled: id }),
      summary: `canceled reminder ${id}`,
    };
  }

  // schedule_reminder doesn't need a repo target.
  if (toolName === "schedule_reminder") {
    // Prefer delay_seconds (relative) — most reliable since the AI doesn't
    // have to do timezone arithmetic. Fall back to fire_at (absolute).
    let when: number;
    if (input.delay_seconds !== undefined && input.delay_seconds !== null) {
      const secs = typeof input.delay_seconds === "string"
        ? parseInt(input.delay_seconds, 10)
        : Number(input.delay_seconds);
      if (!Number.isFinite(secs) || secs <= 0) {
        throw new Error("schedule_reminder: invalid delay_seconds (must be a positive integer)");
      }
      if (secs > 60 * 60 * 24 * 365) {
        throw new Error("schedule_reminder: delay_seconds > 1 year");
      }
      when = Date.now() + secs * 1000;
    } else if (input.fire_at) {
      when = Date.parse(input.fire_at);
      if (!when || isNaN(when)) {
        throw new Error("schedule_reminder: invalid fire_at ISO datetime");
      }
      if (when < Date.now() - 60_000) {
        throw new Error("schedule_reminder: fire_at is in the past");
      }
    } else {
      throw new Error("schedule_reminder: must provide either delay_seconds or fire_at");
    }

    const message = (input.message || "Reminder").slice(0, 200);
    const id = "rem_" + Math.random().toString(36).slice(2, 12);
    await addReminder({ id, fireAt: when, message, createdAt: Date.now() });
    const secondsFromNow = Math.round((when - Date.now()) / 1000);
    const humanWhen = secondsFromNow < 120
      ? `in ${secondsFromNow}s`
      : secondsFromNow < 3600
      ? `in ${Math.round(secondsFromNow / 60)}min`
      : new Date(when).toISOString();
    return {
      content: JSON.stringify({ id, fireAt: when, message, secondsFromNow }),
      summary: `scheduled "${message.slice(0, 40)}" ${humanWhen}`,
    };
  }

  // GitHub-touching tools below all need a repo target.
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
