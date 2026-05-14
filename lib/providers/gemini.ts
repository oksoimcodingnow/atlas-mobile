/**
 * GOOGLE GEMINI provider
 * ======================
 * Runs the same agentic loop but via Google's @google/genai SDK.
 * Gemini uses a slightly different shape for tools and messages:
 *   - Tools: { functionDeclarations: [{ name, description, parameters }] }
 *   - Roles: "user" / "model" (not "assistant")
 *   - Tool calls: { functionCall: { name, args } }
 *   - Tool results: { functionResponse: { name, response } }
 *
 * We translate to/from this shape so the rest of ATLAS doesn't care
 * which provider answered.
 */
import { GoogleGenAI, Type } from "@google/genai";
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

// Convert our JSON schemas (strings) to Gemini's Type enums.
function toGeminiSchema(p: Record<string, { type?: string; description?: string } | undefined>) {
  const out: Record<string, { type: Type; description?: string }> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!v) continue;
    out[k] = { type: Type.STRING, description: v.description };
  }
  return out;
}

function geminiTools() {
  return [
    {
      functionDeclarations: TOOL_SCHEMAS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: Type.OBJECT,
          properties: toGeminiSchema(t.parameters.properties as Record<string, { type?: string; description?: string } | undefined>),
          required: t.parameters.required,
        },
      })),
    },
  ];
}

// Convert our generic message history -> Gemini's `contents` format.
// Gemini uses `role: "model"` for assistant turns.
type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: string } } };

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function toGeminiHistory(messages: GenericMessage[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
}

export async function runGemini(opts: RunOptions): Promise<void> {
  const { apiKey, model, repo, messages, octokit, defaultUser, write } = opts;

  const ai = new GoogleGenAI({ apiKey });
  const tools = geminiTools();
  const now = new Date();
  const systemInstruction =
    SYSTEM_PROMPT +
    `\n\nDefault GitHub user: ${defaultUser}` +
    `\nCurrent date and time: ${now.toString()} (ISO: ${now.toISOString()}).` +
    ` Use this when computing relative times like "in 5 minutes" or "tomorrow at 7pm".` +
    ` The current YEAR is ${now.getFullYear()} — do not invent a different one.` +
    (repo ? `\nUser's current repo context: ${repo}` : "");

  const contents: GeminiContent[] = toGeminiHistory(messages);

  for (let iter = 0; iter < 10; iter++) {
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction,
        tools,
      },
    });

    // Buffer this turn's parts so we can append them to history.
    const turnParts: GeminiPart[] = [];
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let receivedAnyText = false;

    for await (const chunk of stream) {
      // Gemini packages text and function calls inside `candidates[0].content.parts`.
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      for (const part of parts) {
        if (typeof part.text === "string" && part.text.length > 0) {
          receivedAnyText = true;
          write(sseChunk({ type: "text", text: part.text }));
          turnParts.push({ text: part.text });
        } else if (part.functionCall) {
          functionCalls.push({
            name: part.functionCall.name ?? "",
            args: (part.functionCall.args as Record<string, unknown>) ?? {},
          });
          turnParts.push({
            functionCall: {
              name: part.functionCall.name ?? "",
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
            },
          });
        }
      }
    }

    // If no function calls happened, the model's done.
    if (functionCalls.length === 0) {
      write(sseChunk({ type: "done" }));
      // Append empty model turn just for cleanliness if no text either.
      if (!receivedAnyText) {
        contents.push({ role: "model", parts: [{ text: "" }] });
      } else if (turnParts.length > 0) {
        contents.push({ role: "model", parts: turnParts });
      }
      break;
    }

    // Add the model's turn (text + tool calls) to history.
    contents.push({ role: "model", parts: turnParts });

    // Execute each function call and feed results back as a `user` turn
    // containing `functionResponse` parts.
    const responseParts: GeminiPart[] = [];
    for (const call of functionCalls) {
      const fakeId = "g_" + Math.random().toString(36).slice(2, 10);
      write(
        sseChunk({
          type: "tool_use",
          id: fakeId,
          name: call.name,
          input: call.args,
        }),
      );
      try {
        const result = await runTool(
          call.name,
          call.args as ToolInput,
          { octokit, defaultUser },
        );
        write(
          sseChunk({
            type: "tool_result",
            id: fakeId,
            is_error: false,
            summary: result.summary,
          }),
        );
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { result: result.content },
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        write(
          sseChunk({
            type: "tool_result",
            id: fakeId,
            is_error: true,
            summary: msg,
          }),
        );
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { result: "Error: " + msg },
          },
        });
      }
    }

    contents.push({ role: "user", parts: responseParts });
  }
}
