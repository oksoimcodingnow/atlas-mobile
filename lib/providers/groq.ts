/**
 * GROQ (Llama 3.3 70B) provider
 * =============================
 * Runs the same agentic loop using Groq's OpenAI-compatible API.
 *
 * Groq hosts open-source models (Llama, Mixtral, Qwen) on custom silicon
 * — gets ~500 tokens/sec which is much faster than any cloud LLM.
 * Free tier is generous: 30 RPM, 14,400 RPD on Llama 3.3 70B (as of 2026).
 *
 * Tool calling uses OpenAI's format (different from Anthropic and Gemini):
 *   - Tools: [{ type: "function", function: { name, description, parameters } }]
 *   - Tool calls: choice.delta.tool_calls = [{ id, function: { name, arguments: "<JSON string>" } }]
 *   - Tool results: { role: "tool", tool_call_id, content }
 *
 * One quirk: Groq streams tool_call arguments piece-by-piece. We have to
 * concatenate the fragments before parsing the JSON.
 */
import Groq from "groq-sdk";
import { Octokit } from "@octokit/rest";
import { TOOL_SCHEMAS, SYSTEM_PROMPT, runTool, ToolInput, sseChunk } from "../tools";

interface GenericMessage {
  role: "user" | "assistant";
  content: string | Array<unknown>;
}

interface RunOptions {
  apiKey: string;
  model: string;
  repo?: string;
  messages: GenericMessage[];
  octokit: Octokit;
  defaultUser: string;
  write: (chunk: Uint8Array) => void;
}

// OpenAI-style tool format. Same JSON schema, different envelope shape.
function groqTools() {
  return TOOL_SCHEMAS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// OpenAI message format. The "tool" role is for tool results.
type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAIHistory(messages: GenericMessage[]): OpenAIMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  })) as OpenAIMessage[];
}

export async function runGroq(opts: RunOptions): Promise<void> {
  const { apiKey, model, repo, messages, octokit, defaultUser, write } = opts;

  const client = new Groq({ apiKey });
  const tools = groqTools();
  const now = new Date();

  const systemMessage: OpenAIMessage = {
    role: "system",
    content:
      SYSTEM_PROMPT +
      `\n\nDefault GitHub user: ${defaultUser}` +
      `\nCurrent date and time: ${now.toString()} (ISO: ${now.toISOString()}).` +
      ` Use this when computing relative times like "in 5 minutes" or "tomorrow at 7pm".` +
      ` The current YEAR is ${now.getFullYear()} — do not invent a different one.` +
      (repo ? `\nUser's current repo context: ${repo}` : ""),
  };

  const conversation: OpenAIMessage[] = [systemMessage, ...toOpenAIHistory(messages)];

  for (let iter = 0; iter < 10; iter++) {
    const stream = await client.chat.completions.create({
      model,
      messages: conversation,
      tools,
      tool_choice: "auto",
      stream: true,
      max_tokens: 4096,
    });

    // Accumulators for this turn's response. Groq streams text and tool
    // call args piece-by-piece — we have to stitch them together.
    let assistantText = "";
    // Indexed by `index` because that's how OpenAI/Groq stream parallel tool calls.
    const toolCallBuffers: Record<number, { id: string; name: string; args: string }> = {};
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;

      if (delta?.content) {
        assistantText += delta.content;
        write(sseChunk({ type: "text", text: delta.content }));
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallBuffers[idx]) {
            toolCallBuffers[idx] = { id: "", name: "", args: "" };
          }
          if (tc.id) toolCallBuffers[idx].id = tc.id;
          if (tc.function?.name) toolCallBuffers[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallBuffers[idx].args += tc.function.arguments;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const collectedToolCalls = Object.values(toolCallBuffers).filter((t) => t.name);

    // Record the assistant turn (text + tool calls if any) in conversation history.
    if (collectedToolCalls.length > 0) {
      conversation.push({
        role: "assistant",
        content: assistantText || null,
        tool_calls: collectedToolCalls.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.args },
        })),
      });
    } else if (assistantText) {
      conversation.push({ role: "assistant", content: assistantText });
    }

    // No tool calls → conversation is done.
    if (collectedToolCalls.length === 0 || finishReason === "stop") {
      if (collectedToolCalls.length === 0) {
        write(sseChunk({ type: "done" }));
        break;
      }
    }

    // Execute each tool call and feed results back as `role: "tool"` messages.
    for (const tc of collectedToolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.args || "{}");
      } catch {
        parsedArgs = {};
      }

      write(
        sseChunk({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: parsedArgs,
        }),
      );

      try {
        const result = await runTool(
          tc.name,
          parsedArgs as ToolInput,
          { octokit, defaultUser },
        );
        write(
          sseChunk({
            type: "tool_result",
            id: tc.id,
            is_error: false,
            summary: result.summary,
          }),
        );
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.content,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        write(
          sseChunk({
            type: "tool_result",
            id: tc.id,
            is_error: true,
            summary: msg,
          }),
        );
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Error: " + msg,
        });
      }
    }
  }
}
