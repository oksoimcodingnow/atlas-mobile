# ATLAS Mobile

A mobile AI coding agent. Open it on your phone, message it like a friend, watch it read and commit code in your GitHub repos.

> Companion to [atlas-dashboard](https://github.com/oksoimcodingnow/atlas-dashboard) — the same Jarvis-y aesthetic, but living in your phone's home screen.

## What it does

You text ATLAS something like:

> *"add a logout button to the top-right nav in roshop"*

ATLAS uses Claude to:
1. Pick the right tool (`list_repo_files` to find the file, `read_repo_file` to see current code)
2. Decide the change
3. Call `write_repo_file` — which commits + pushes to your GitHub repo

You arrive at your desk, `git pull`, and there's a commit waiting.

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS PWA | No framework, installable to home screen |
| Backend | Vercel serverless function (Node.js) | Free Hobby tier, no credit card |
| AI | Anthropic Claude API + tool use | Opus 4.7 / Sonnet 4.6 / Haiku 4.5 swappable |
| Git ops | GitHub REST API via Octokit | Read/write/commit your repos |
| Streaming | Server-Sent Events | Real-time response in the chat UI |

## Clone & run locally

Works on Windows, Mac, Linux. Identical on both PCs.

```bash
# 1. Clone
git clone https://github.com/oksoimcodingnow/atlas-mobile.git
cd atlas-mobile

# 2. Install deps
npm install

# 3. Copy the env template and fill in your keys
cp .env.example .env.local
# Then edit .env.local in any text editor

# 4. Install Vercel CLI (one-time, global)
npm install -g vercel

# 5. Run locally — opens at http://localhost:3000
vercel dev
```

### What goes in `.env.local`

| Variable | Where to get it |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys (starts with `sk-ant-`) |
| `GITHUB_TOKEN` | https://github.com/settings/tokens/new → check `repo` scope |
| `GITHUB_USER` | Your GitHub username (e.g. `oksoimcodingnow`) |

**Important:** `.env.local` is gitignored — your keys never reach GitHub. Each PC needs its own copy.

## Deploy to Vercel (so you can use it on your phone)

```bash
# One-time: link the project to Vercel
vercel link

# Add env vars (Vercel will prompt — paste your keys)
vercel env add ANTHROPIC_API_KEY production
vercel env add GITHUB_TOKEN production
vercel env add GITHUB_USER production

# Deploy
vercel --prod
```

Vercel gives you a URL like `https://atlas-mobile.vercel.app`. Open it on your phone, then:

- **iPhone**: Safari → Share → Add to Home Screen
- **Android**: Chrome → menu → Install app

Now ATLAS lives on your home screen like a native app.

## Working on 2 PCs

The whole setup is cloneable:

| Each PC needs | What |
|---------------|------|
| The repo | `git clone https://github.com/oksoimcodingnow/atlas-mobile.git` |
| Node.js 18+ | https://nodejs.org |
| Vercel CLI | `npm install -g vercel` |
| Its own `.env.local` | Copy `.env.example` → fill in real keys |
| GitHub credentials configured | For `git push` to work — see atlas-dashboard README |

Production env vars on Vercel are shared across both PCs automatically — you only set them once.

## How the tools work

The serverless function gives Claude three tools. Claude decides when to call which:

| Tool | What it does | GitHub API used |
|------|--------------|-----------------|
| `list_repo_files` | List files in a repo path | `GET /repos/{owner}/{repo}/contents/{path}` |
| `read_repo_file` | Read a file's full content | `GET /repos/.../contents/{path}` |
| `write_repo_file` | Create/overwrite a file + commit + push | `PUT /repos/.../contents/{path}` |

The agentic loop:
1. User message → Claude
2. Claude responds with text and/or tool_use blocks
3. Server executes the tools (read/write GitHub)
4. Results fed back to Claude
5. Repeat until Claude says `end_turn`

Limit: 10 iterations per turn (safety cap against runaway loops).

## Costs

ATLAS Mobile uses pay-per-token APIs:

| Resource | Cost |
|----------|------|
| Vercel Hobby tier | **Free** (generous — 100GB bandwidth/month, 100k function invocations) |
| Anthropic API | Pay per token. Opus 4.7 = $5/$25 per 1M, Sonnet 4.6 = $3/$15, Haiku 4.5 = $1/$5 |
| GitHub API | Free for your own repos |

Use Sonnet 4.6 for daily chat to keep costs low. Switch to Opus 4.7 in the slicer when you need real horsepower.

## Roadmap

- [ ] Add OpenAI GPT-5 / GPT-4o to the slicer (multi-provider)
- [ ] Voice input (Web Speech API)
- [ ] Voice output (TTS reading Claude's responses)
- [ ] Persistent chat history (Firestore or KV)
- [ ] Pull request creation (instead of direct commits)
- [ ] Code diff preview before commit
- [ ] Multiple repo support (saved repo list)

## License

MIT — do whatever you want.

---

Built by [@oksoimcodingnow](https://github.com/oksoimcodingnow) — Y3 Financial Engineering, building tools to make coding feel intentional.
