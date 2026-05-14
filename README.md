# ATLAS Mobile (v2 — Next.js)

> AI coding agent in your phone's home screen. Message it, watch it read + commit code to your GitHub repos.

**Live:** https://atlas-mobile-theta.vercel.app

This is the **v2 rewrite** in Next.js 15 + TypeScript + Tailwind v4. The original vanilla JS version still lives in git history — checkout commit `bcf3cca` to see it.

## 🎓 Built as a learning project

I'm new to React. This codebase has rich comments throughout explaining concepts as they come up. Start in this order:

1. [`app/layout.tsx`](./app/layout.tsx) — root layout, PWA metadata, viewport config
2. [`app/page.tsx`](./app/page.tsx) — the main chat UI (heavily commented React tutorial)
3. [`app/api/chat/route.ts`](./app/api/chat/route.ts) — the Next.js Route Handler backend
4. [`app/globals.css`](./app/globals.css) — Tailwind v4 design tokens

## Stack

| Layer | Tech | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Vercel-native, easy deploy, file-based routing |
| Language | TypeScript | Catches typos, better autocomplete |
| Styling | Tailwind v4 | Utility classes — no separate CSS files for components |
| Icons | Lucide React | Clean SVG icons |
| AI | Anthropic Claude API + tool use | Streams responses, calls GitHub tools |
| Local AI | Ollama | Test chat locally without paid API keys |
| Git ops | Octokit (GitHub REST API) | Read/write/commit your repos |
| Hosting | Vercel (free Hobby tier) | Frontend + serverless backend, auto-deploys |

## Run locally

```bash
git clone https://github.com/oksoimcodingnow/atlas-mobile.git
cd atlas-mobile
npm install

# Set up env vars
cp .env.example .env.local
# Edit .env.local with your real keys

npm run dev
# Opens at http://localhost:3000
```

### Local no-credit testing with Ollama

ATLAS has an `OLLAMA` slicer option for local chat testing. It does not use
Anthropic, Gemini, Groq, or GitHub tool calls.

```bash
# Install Ollama first from https://ollama.com/download
ollama pull llama3.2:3b
ollama serve

npm run dev
# Open http://localhost:3000 and choose OLLAMA in the model slicer
```

For a different local model, set `OLLAMA_MODEL` in `.env.local`.

### Env vars

| Variable | Where to get it |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `GITHUB_TOKEN` | https://github.com/settings/tokens/new (check `repo` scope) |
| `GITHUB_USER` | Your GitHub username |

**Local dev only:** these go in `.env.local` (gitignored).
**Production:** added in the Vercel dashboard, never in code.

## Deploy

Connected to Vercel — every `git push` to `main` auto-deploys to https://atlas-mobile-theta.vercel.app

## How it works

```
phone browser
   ↓ POST /api/chat (Server-Sent Events stream)
Next.js Route Handler
   ↓ Anthropic SDK with tools
Claude API
   ↓ wants to call a tool
our code runs the tool via Octokit
   ↓ reads/writes GitHub
result → Claude → maybe another tool → eventual end_turn
```

Each round-trip streams text deltas + tool events back to the browser as SSE messages, so the user sees Claude "thinking" live.

The agentic loop is capped at 10 iterations per turn (safety against runaway loops).

## What's next

- [ ] Voice input + TTS output
- [ ] Google Calendar OAuth + push notifications for work/study schedule
- [ ] OpenAI / Gemini models in the slicer (multi-provider)
- [ ] Persistent chat history (Vercel KV or Firestore)
- [ ] Pull-request creation flow (instead of direct commits)
- [ ] Code diff preview before commit

## License

MIT
