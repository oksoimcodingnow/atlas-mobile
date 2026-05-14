/**
 * /api/chat — Multi-provider router
 * =================================
 *
 * Picks the right AI provider based on the requested model:
 *   - Claude models  -> Anthropic SDK
 *   - Gemini models  -> Google GenAI SDK
 *   - Ollama models  -> local Ollama daemon
 *
 * Cloud providers share the same tool implementation (lib/tools.ts) and
 * stream events back in the same SSE format, so the frontend doesn't
 * care which one answered.
 *
 * Cloud providers run an AGENTIC LOOP: the AI may want to call a tool, we run
 * it, feed the result back, repeat until the AI is done. Ollama local mode is
 * chat-only so it can be tested without paid API keys or GitHub writes.
 */

import { Octokit } from "@octokit/rest";
import { runAnthropic } from "@/lib/providers/anthropic";
import { runGemini } from "@/lib/providers/gemini";
import { runGroq } from "@/lib/providers/groq";
import { runOllama } from "@/lib/providers/ollama";
import { sseChunk } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatRequest {
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  repo?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;
  const { messages = [], model = "gemini-2.5-flash", repo } = body;

  // Decide which provider to use based on the model name.
  const lowered = model.toLowerCase();
  const isOllama = lowered === "ollama" || lowered.startsWith("ollama/");
  const isGemini = lowered.startsWith("gemini");
  const isGroq = lowered.startsWith("llama") || lowered.startsWith("mixtral") || lowered.startsWith("qwen");
  const isAnthropic = !isOllama && !isGemini && !isGroq;
  const defaultUser = process.env.GITHUB_USER || "";

  let octokit: Octokit | null = null;
  if (!isOllama) {
    if (!process.env.GITHUB_TOKEN) {
      return new Response("Server missing GITHUB_TOKEN", { status: 500 });
    }
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }

  if (isGemini && !process.env.GEMINI_API_KEY) {
    return new Response("Server missing GEMINI_API_KEY", { status: 500 });
  }
  if (isGroq && !process.env.GROQ_API_KEY) {
    return new Response("Server missing GROQ_API_KEY", { status: 500 });
  }
  if (isAnthropic && !process.env.ANTHROPIC_API_KEY) {
    return new Response("Server missing ANTHROPIC_API_KEY", { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const write = (chunk: Uint8Array) => controller.enqueue(chunk);

      try {
        if (isOllama) {
          await runOllama({
            model,
            repo,
            messages,
            defaultUser,
            write,
          });
        } else if (isGemini) {
          await runGemini({
            apiKey: process.env.GEMINI_API_KEY!,
            model,
            repo,
            messages,
            octokit: octokit!,
            defaultUser,
            write,
          });
        } else if (isGroq) {
          await runGroq({
            apiKey: process.env.GROQ_API_KEY!,
            model,
            repo,
            messages,
            octokit: octokit!,
            defaultUser,
            write,
          });
        } else {
          await runAnthropic({
            apiKey: process.env.ANTHROPIC_API_KEY!,
            model,
            repo,
            messages,
            octokit: octokit!,
            defaultUser,
            write,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        write(sseChunk({ type: "error", message: msg }));
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
