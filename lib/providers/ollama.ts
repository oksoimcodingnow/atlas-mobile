/**
 * OLLAMA provider
 * ===============
 * Runs ATLAS chat against a local Ollama daemon. This path does not use paid
 * AI API keys and intentionally runs without GitHub tools.
 */
import { SYSTEM_PROMPT, sseChunk } from "../tools";

interface GenericMessage {
  role: "user" | "assistant";
  content: string | Array<unknown>;
}

interface RunOptions {
  model: string;
  repo?: string;
  messages: GenericMessage[];
  defaultUser: string;
  write: (chunk: Uint8Array) => void;
}

interface OllamaStreamChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

function ollamaModelName(model: string): string {
  if (model.toLowerCase().startsWith("ollama/")) {
    return model.slice("ollama/".length);
  }
  return process.env.OLLAMA_MODEL || "llama3.2:3b";
}

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

function toOllamaMessages(messages: GenericMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
}

export async function runOllama(opts: RunOptions): Promise<void> {
  const { model, repo, messages, defaultUser, write } = opts;
  const now = new Date();
  const baseUrl = ollamaBaseUrl();
  const localModel = ollamaModelName(model);

  const systemPrompt =
    SYSTEM_PROMPT +
    `\n\nDefault GitHub user: ${defaultUser || "unknown"}` +
    `\nCurrent date and time: ${now.toString()} (ISO: ${now.toISOString()}).` +
    ` The current YEAR is ${now.getFullYear()} - do not invent a different one.` +
    `\nYou are running in local Ollama mode. No paid AI API keys are being used.` +
    ` GitHub read/write tools are disabled in this local mode.` +
    (repo ? `\nUser's current repo context: ${repo}` : "");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: localModel,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...toOllamaMessages(messages),
        ],
      }),
    });
  } catch {
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. ` +
        `Install/start Ollama and run: ollama pull ${localModel}`,
    );
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${response.status}). ` +
        `Make sure Ollama is running and the model exists: ollama pull ${localModel}. ` +
        text,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as OllamaStreamChunk;
      if (chunk.error) throw new Error(chunk.error);
      const text = chunk.message?.content || "";
      if (text) write(sseChunk({ type: "text", text }));
      if (chunk.done) {
        write(sseChunk({ type: "done" }));
        return;
      }
    }
  }

  if (pending.trim()) {
    const chunk = JSON.parse(pending) as OllamaStreamChunk;
    if (chunk.error) throw new Error(chunk.error);
    const text = chunk.message?.content || "";
    if (text) write(sseChunk({ type: "text", text }));
  }

  write(sseChunk({ type: "done" }));
}
