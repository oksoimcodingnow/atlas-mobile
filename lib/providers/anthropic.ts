/**
 * ANTHROPIC (Claude) provider
 * ===========================
 * Runs the agentic loop using Anthropic's SDK. Streams text deltas and
 * tool events back to the caller via the `write` callback.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import {
  TOOL_SCHEMAS,
  SYSTEM_PROMPT,
  runTool,
  ToolInput,
  sseChunk,
} from "../tools";

interface RunOptions {
  apiKey: string;
  model: string;
  repo?: string;
  messages: Anthropic.MessageParam[];
  octokit: Octokit;
  defaultUser: string;
  write: (chunk: Uint8Array) => void;
}

// Anthropic's tool format requires `input_schema` instead of `parameters`.
function toAnthropicTools(): Anthropic.Tool[] {
  return TOOL_SCHEMAS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
  }));
}

export async function runAnthropic(opts: RunOptions): Promise<void> {
  const { apiKey, model, repo, messages, octokit, defaultUser, write } = opts;

  const anthropic = new Anthropic({ apiKey });
  const tools = toAnthropicTools();

  // Two system blocks: the first is stable (prompt + default user) and cached;
  // the second carries volatile context (current date, repo) and is NOT cached.
  // Splitting them keeps the prompt cache warm across requests even though
  // the date changes every call.
  const now = new Date();
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: SYSTEM_PROMPT + `\n\nDefault GitHub user: ${defaultUser}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text:
        `Current date and time: ${now.toString()} (ISO: ${now.toISOString()}).` +
        ` Use this when computing relative times like "in 5 minutes" or "tomorrow at 7pm".` +
        ` The current YEAR is ${now.getFullYear()} — do not invent a different one.` +
        (repo ? `\nUser's current repo context: ${repo}` : ""),
    },
  ];

  const workMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let iter = 0; iter < 10; iter++) {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 4096,
      system: systemBlocks,
      tools,
      messages: workMessages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        write(sseChunk({ type: "text", text: event.delta.text }));
      }
    }

    const finalMsg = await stream.finalMessage();
    workMessages.push({ role: "assistant", content: finalMsg.content });

    if (finalMsg.stop_reason !== "tool_use") {
      write(sseChunk({ type: "done" }));
      break;
    }

    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      write(
        sseChunk({
          type: "tool_use",
          id: tu.id,
          name: tu.name,
          input: tu.input,
        }),
      );
      try {
        const result = await runTool(
          tu.name,
          tu.input as ToolInput,
          { octokit, defaultUser },
        );
        write(
          sseChunk({
            type: "tool_result",
            id: tu.id,
            is_error: false,
            summary: result.summary,
          }),
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: result.content,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        write(
          sseChunk({
            type: "tool_result",
            id: tu.id,
            is_error: true,
            summary: msg,
          }),
        );
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
}
