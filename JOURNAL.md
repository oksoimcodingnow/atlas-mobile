# ATLAS Mobile — Project Journal

> A mobile AI coding agent that lives in your phone's home screen.
> Written for my own reference — no coding experience assumed.

---

## What is ATLAS Mobile?

A web app that opens like a normal app on your phone. You message it like a friend, and it reads, edits, and commits code in your GitHub repos for you.

Use case: I'm on the bus, I text ATLAS "*add a logout button to roshop's nav*". ATLAS asks Claude (or free Gemini), Claude reads my roshop repo, edits the file, commits + pushes. By the time I get home, the change is on GitHub waiting for me.

**Live at:** https://atlas-mobile-theta.vercel.app

---

## Project Files

| File | What it does |
|------|-------------|
| `app/page.tsx` | The main chat screen (React component, heavily commented as a tutorial) |
| `app/layout.tsx` | Root layout — sets PWA metadata, theme color, viewport for phones |
| `app/globals.css` | Tailwind v4 design tokens (cyan colors, fonts, animations) |
| `app/api/chat/route.ts` | The backend endpoint — router that picks the AI provider |
| `lib/providers/anthropic.ts` | Talks to Claude API with tool use + streaming |
| `lib/providers/gemini.ts` | Talks to Google Gemini Flash (free tier) with tool use + streaming |
| `lib/tools.ts` | Shared GitHub tool definitions (`list_repo_files`, `read_repo_file`, `write_repo_file`) |
| `.handshake/` | AI review workflow: Codex packet -> Claude/ChatGPT review -> Codex response -> final decision |
| `public/manifest.webmanifest` | Tells phones "this is an installable app" |
| `.env.example` | Template showing which secrets you need (never commit real keys) |

---

## How to Run It Locally

> **Important:** You need Node.js 18+ installed. Get it at https://nodejs.org

1. Clone the repo:
   ```bash
   git clone https://github.com/oksoimcodingnow/atlas-mobile.git
   cd atlas-mobile
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the env template and fill in your keys:
   ```bash
   cp .env.example .env.local
   ```
   Then open `.env.local` in any text editor and paste your real API keys.
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open **http://localhost:3000** in your browser.

| Page | URL | What it is |
|------|-----|-----------|
| Chat | `http://localhost:3000/` | The main mobile chat UI |
| API | `http://localhost:3000/api/chat` | Backend endpoint (POST only) |

### Does the site run when my PC is off?
**Yes** — the live site at `https://atlas-mobile-theta.vercel.app` runs on Vercel's servers 24/7. You only need your PC on when you want to **make changes** to the code. Push to GitHub → Vercel auto-redeploys in ~30 seconds.

---

## Tech Stack

| Tool | What it's for |
|------|--------------|
| Next.js 16 (App Router) | The framework — file-based routing, server-side rendering, API routes |
| React 19 | UI library — components, hooks (`useState`, `useEffect`, `useRef`) |
| TypeScript | Catches typos and bad function calls before they hit production |
| Tailwind v4 | Utility-first CSS — `className="flex items-center gap-2"` instead of writing CSS files |
| Anthropic SDK | Talks to Claude (Opus 4.7, Sonnet 4.6, Haiku 4.5) |
| Google GenAI SDK | Talks to Gemini 2.5 Flash (free tier) |
| Octokit | GitHub REST API client (read/write files, commit) |
| Lucide React | Clean SVG icons (Send, Trash, Wrench, etc.) |
| Vercel | Hosting — serverless functions + static frontend, free Hobby tier |
| GitHub | Version control, where my repos live |

---

## AI Handshake Protocol

For risky changes, use the `.handshake/` folder before committing.

The workflow:

1. Codex writes `.handshake/01_codex_packet.md`
2. Paste that packet into Claude Pro or ChatGPT Plus
3. Paste the review into `.handshake/02_external_review.md`
4. Codex responds/fixes in `.handshake/03_codex_response.md`
5. Final status goes in `.handshake/04_decision.md`

Use this for GitHub-writing tools, reminders, cron, secrets, deployment, and multi-file refactors.

---

## API Keys & Secrets

### What each key does

| Variable | Required when | Where to get | Cost |
|----------|---------------|--------------|------|
| `GEMINI_API_KEY` | Using Gemini (free models) | https://aistudio.google.com/apikey | $0 — 1500 chats/day free |
| `ANTHROPIC_API_KEY` | Using Claude models | https://console.anthropic.com | Pay per token |
| `GITHUB_TOKEN` | Always (so ATLAS can read/write your repos) | https://github.com/settings/tokens/new (check `repo` scope) | Free |
| `GITHUB_USER` | Always | Your GitHub username | Free |

### Where they go

- **Local dev (your PC):** in `.env.local` — this file is **gitignored** so your keys never reach GitHub.
- **Production (Vercel):** added in the Vercel dashboard → Settings → Environment Variables. Same security model.

### Subscription vs API — important!

- **ChatGPT Plus** ($20/mo) ≠ OpenAI API access. Separate billing.
- **Claude Pro/Max** ($20+/mo) ≠ Anthropic API access. Separate billing.
- The free Gemini API tier IS truly free — no card required for 1500 req/day.

---

## How the Agentic Loop Works

When you message ATLAS "*add a logout button to roshop's nav*":

1. The phone POSTs your message + history to `/api/chat`
2. The backend (`app/api/chat/route.ts`) picks Claude or Gemini based on which model you chose in the slicer
3. The AI receives a system prompt + 3 tool definitions: `list_repo_files`, `read_repo_file`, `write_repo_file`
4. The AI decides to call `list_repo_files` → backend uses Octokit to query GitHub → result fed back
5. The AI calls `read_repo_file` for index.html → backend reads it → result fed back
6. The AI writes the new version + commit message → backend calls `write_repo_file` → Octokit commits + pushes
7. The AI replies "done — committed abc123f"
8. Loop ends (capped at 10 iterations for safety)

Every step streams back to the phone via **Server-Sent Events (SSE)** — text appears live as the AI types.

---

## Provider Parity

Both Claude and Gemini support tool use, but the SDK formats differ:

| Concept | Claude | Gemini |
|---------|--------|--------|
| Tool def | `input_schema` | `parameters` |
| Tool call event | `content_block_delta` + `tool_use` block | `functionCall` in `parts` |
| Tool result | `tool_result` block | `functionResponse` part |
| Assistant role | `"assistant"` | `"model"` |

The translation lives in `lib/providers/anthropic.ts` and `lib/providers/gemini.ts`. Both functions take the same input shape and produce the same SSE output — so the frontend doesn't know which AI answered.

---

## Big Things We Built / Changed

### v0.0.1 — Vanilla scaffold (RIP, but in git history)
- Pure HTML/CSS/JS + a single `api/chat.js` Vercel function
- Worked but mobile UX was rough
- Lives at git commit `bcf3cca` if I ever want to look back

### v0.0.2 — Next.js rewrite (with React tutorial in the code)
- Full rewrite in Next.js 16 + TypeScript + Tailwind v4
- Heavy educational comments in `app/page.tsx` explaining React hooks, JSX, etc.
- I'm a complete React beginner — this codebase IS my React tutorial

### v0.0.3 — Multi-provider (Gemini + Claude)
- Split backend into `lib/providers/anthropic.ts` and `lib/providers/gemini.ts`
- Shared tools/system prompt in `lib/tools.ts`
- Slicer now offers GEMINI / HAIKU / SONNET / OPUS pills
- **Defaulted to free Gemini** so I can chat without spending anything

### v0.0.4 — Push notifications + scheduled reminders (the "Jarvis on my phone" upgrade)
- Service worker at `public/sw.js` — receives Web Push events, shows notifications, deep-links on tap
- VAPID-signed push via `web-push` library (`lib/push.ts`)
- `ENABLE` button in header — requests permission, subscribes via PushManager, sends a test push
- Subscription saved server-side to Vercel KV (Upstash Redis) so cron can fire pushes when ATLAS isn't open
- New AI tool: `schedule_reminder({fire_at, message})` — ATLAS can now schedule pushes from chat
- `/api/cron/tick` endpoint pulls due reminders + sends pushes
- GitHub Action (`.github/workflows/cron-tick.yml`) hits the endpoint every minute — free on public repos
- Refactored `runTool` to accept a `ToolContext` so new tools can plug in without breaking the providers
- `SETUP_PUSH.md` walks through end-user wiring (Vercel KV, env vars, GitHub Action secrets, phone install)

---

## Deploying Updates

Vercel watches the GitHub repo. Any push to `main` triggers an auto-redeploy that takes ~30-60 seconds. Workflow:

```bash
git add .
git commit -m "describe what changed"
git push
```

Watch progress at https://vercel.com/protocol-s-projects/atlas-mobile/deployments

---

## Install to Phone Home Screen

### iPhone (Safari)
1. Open https://atlas-mobile-theta.vercel.app/
2. Tap the **Share** icon (square with up arrow)
3. Scroll down → **Add to Home Screen**
4. Now ATLAS is an icon on your phone like any other app

### Android (Chrome)
1. Open the URL
2. Tap the ⋮ menu → **Install app** (or **Add to Home Screen**)

After install, ATLAS opens full-screen, no browser bars — feels like a native app.

---

## Bugs We Fixed Along the Way

| Bug | What happened | Fix |
|-----|--------------|-----|
| Vanilla version 404'd on `/api/chat` | Wrong `vercel.json` routing | Restructured to modern Vercel convention (no vercel.json) |
| Next.js rewrite 404'd on `/` | Vercel project still configured as static from vanilla setup | Changed Framework Preset to Next.js in Vercel settings |
| TypeScript error in `gemini.ts` | Heterogeneous tool schemas couldn't be unified by TS | Relaxed type to `Record<string, { type?, description? } \| undefined>` |
| "Credit balance too low" | Anthropic account had $0 | Added Gemini free tier as default |

---

## To-Do List

- [x] Vanilla v1 deployed to Vercel
- [x] Next.js v2 rewrite with educational comments
- [x] Multi-provider (Claude + free Gemini)
- [x] Mobile-friendly PWA install
- [x] **Web Push + scheduled reminders** (chat "remind me at 7pm" → phone vibrates)
- [ ] Google Calendar OAuth — auto-fetch upcoming events and schedule reminders
- [ ] AI "cheap reviewer" pass — Haiku/Gemini reviews Claude's commits, opens issues if problems found
- [ ] Voice input (Web Speech API) + TTS output
- [ ] Persistent chat history (in the same KV)
- [ ] Pull-request creation instead of direct commits
- [ ] Code diff preview before commit
- [ ] Add OpenAI GPT models to the slicer (when I have an OpenAI API key)
- [ ] Maybe shadcn/ui for fancier components (low priority — current UI works)

---

## Useful Links

| What | URL |
|------|-----|
| Live app | https://atlas-mobile-theta.vercel.app |
| GitHub repo | https://github.com/oksoimcodingnow/atlas-mobile |
| Vercel dashboard | https://vercel.com/protocol-s-projects/atlas-mobile |
| Anthropic console | https://console.anthropic.com |
| Gemini API keys | https://aistudio.google.com/apikey |
| GitHub PAT settings | https://github.com/settings/tokens |
| Sister project (VSCode) | https://github.com/oksoimcodingnow/atlas-dashboard |
