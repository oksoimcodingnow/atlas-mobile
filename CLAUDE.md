# CLAUDE.md — ATLAS Mobile

> Briefing for AI coding agents working on this repo. Read this first to avoid asking the obvious.

## Latest Codex handoff

- Branch intent: Codex Ollama/local testing work belongs on `codex/ollama-local-test`; Claude experiments should use separate `claude/...` branches and merge by PR/review.
- Added local Ollama chat mode so ATLAS can be tested without Anthropic/Gemini/Groq credits.
- `model: "ollama"` now routes to `lib/providers/ollama.ts`, talks to `OLLAMA_BASE_URL`, and does not require `GITHUB_TOKEN`.
- Mistake fixed: `/api/chat` previously checked `GITHUB_TOKEN` before provider routing, which blocked no-credit local chat testing. The token check now only runs for cloud providers with GitHub tools.
- Important limitation: Ollama mode is chat-only right now. GitHub read/write tools are intentionally disabled in local mode.
- Still needs security work before public use: `/api/chat` cloud-provider path can still use the server GitHub token with write tools; add auth, repo allowlist, and PR-only writes before trusting the live app.

## What this is

**ATLAS Mobile** — a Progressive Web App that lives in the user's phone home screen. Chat UI on the front, AI coding agent on the back. The agent reads, edits, and commits code to the user's GitHub repos via tool use.

**Live:** https://atlas-mobile-theta.vercel.app
**Companion repo:** https://github.com/oksoimcodingnow/atlas-dashboard (VSCode extension version)

## User profile

- Y3 Financial Engineering student building a LinkedIn portfolio
- **Complete React beginner** — this is their first Next.js project
- Preferred style: vanilla web stack normally (HTML/CSS/JS + Firebase)
- This repo is their "learn React via code reading" project — that's why `app/page.tsx` has rich inline tutorial comments
- Casual conversational style; appreciates honest trade-offs over hype

## Stack

- **Next.js 16** App Router, TypeScript, **Tailwind v4** (CSS-based config, no `tailwind.config.js`)
- **Anthropic SDK** (`@anthropic-ai/sdk`) for Claude
- **Google GenAI SDK** (`@google/genai`) for Gemini Flash (free tier)
- **Groq SDK** (`groq-sdk`) for hosted Llama
- **Ollama** for local no-credit chat testing
- **Octokit** (`@octokit/rest`) for GitHub REST API
- **Lucide React** icons
- **Vercel** for hosting (free Hobby tier; auto-deploys on push to main)

## Architecture

```
phone browser
   ↓ POST /api/chat (Server-Sent Events stream)
app/api/chat/route.ts  ← router, picks provider by model name
   ↓
lib/providers/anthropic.ts  OR  lib/providers/gemini.ts
   ↓ calls AI with tool definitions from lib/tools.ts
AI decides to call a tool (e.g. read_repo_file)
   ↓ lib/tools.ts → Octokit → GitHub REST API
result fed back to AI → maybe another tool → end_turn
```

Both providers stream the SAME SSE event shape so the frontend (`app/page.tsx`) doesn't care which AI answered:
- `{type: "text", text: "..."}` — streaming token
- `{type: "tool_use", id, name, input}` — about to call a GitHub tool
- `{type: "tool_result", id, is_error, summary}` — tool finished
- `{type: "done"}` — turn complete
- `{type: "error", message}` — something broke

## Required env vars

| Variable | Required when | Where to get |
|----------|---------------|--------------|
| `OLLAMA_BASE_URL` | local `ollama` model | default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | local `ollama` model | default `llama3.2:3b` |
| `GEMINI_API_KEY` | using `gemini-*` models | https://aistudio.google.com/apikey (free) |
| `GROQ_API_KEY` | using `llama-*` hosted models | https://console.groq.com/keys |
| `ANTHROPIC_API_KEY` | using `claude-*` models | https://console.anthropic.com (paid) |
| `GITHUB_TOKEN` | always | https://github.com/settings/tokens/new — `repo` scope |
| `GITHUB_USER` | always | username (e.g. `oksoimcodingnow`) |
| `VAPID_PUBLIC_KEY` | push notifications | generated once via `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | push notifications | same — keep server-side only |
| `VAPID_SUBJECT` | push notifications | `mailto:you@example.com` |
| `KV_REST_API_URL` | reminders (scheduled push) | auto-injected when Vercel KV is connected |
| `KV_REST_API_TOKEN` | reminders | auto-injected when Vercel KV is connected |
| `CRON_SECRET` | reminders | random hex string; same value as the GitHub `CRON_SECRET` repo secret |

Local dev: `.env.local` (gitignored). Production: Vercel dashboard env vars.

See `SETUP_PUSH.md` for the end-user wiring guide.

## Run locally

```bash
git clone https://github.com/oksoimcodingnow/atlas-mobile.git
cd atlas-mobile
npm install
cp .env.example .env.local   # then fill in real keys
npm run dev                  # → http://localhost:3000
```

## Conventions

- **Handshake for risky work**: use `.handshake/` before non-trivial changes, especially GitHub write/commit behavior, push notifications, cron, KV, auth, secrets, or multi-file refactors.
- **Educational comments**: `app/page.tsx` is heavily commented as a React/Next.js tutorial. Maintain that style — every new concept gets a short inline explainer aimed at a complete beginner. Don't strip these comments for "cleanliness."
- **Provider parity**: Any new tool in `lib/tools.ts` must be supported by BOTH `lib/providers/anthropic.ts` AND `lib/providers/gemini.ts`. Test both before shipping.
- **Models**: Default is `gemini-2.5-flash` (free). Slicer order is cheapest → most expensive: GEMINI / HAIKU / SONNET / OPUS.
- **No frameworks bloat**: Pure Next.js + Tailwind. Don't pull in shadcn/ui or other component libraries without asking — user prefers minimal dependencies.
- **Agentic loop cap**: 10 iterations max per turn (safety against runaway loops).
- **Streaming**: Always stream responses. Never block on full completion.
- **Tool context**: `runTool` now takes a `ToolContext = { octokit, defaultUser }`. New tools can extend this — don't go back to positional args.

## Roadmap (in priority order)

1. **Google Calendar OAuth** — fetch real calendar events, auto-schedule reminders for upcoming events
2. Voice input (Web Speech API) + TTS output
3. AI "cheap reviewer" pass — after Claude commits, fire a Haiku/Gemini call to review the diff and post a follow-up issue if it finds problems
4. Persistent chat history (in the same KV)
5. Pull-request creation flow instead of direct commits
6. Code diff preview before commit

**Shipped (Phase 1 + 2):** Web Push, VAPID, service worker, scheduled `schedule_reminder` tool, Vercel KV storage, GitHub Actions cron tick every minute.

## Things to avoid

- Don't restructure to `pages/` router — we're on App Router permanently
- Don't add Tailwind v3 (we're on v4 with `@theme` in CSS)
- Don't strip the educational comments
- Don't hard-code keys — always use env vars
- Don't break Provider parity (Gemini AND Anthropic must work)

## Linked memories (user-side)

User has these in their persistent memory:
- `user_profile.md` — Y3 Fin Eng, beginner React, GitHub `oksoimcodingnow`
- `workflow_style.md` — vanilla web roots, Firebase-heavy, journals everything
- `atlas_project.md` — this project's roadmap and history
