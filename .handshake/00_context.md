# 00 Context

Project: ATLAS Mobile

Purpose:
- Mobile-first PWA for coding from a phone.
- Next.js App Router frontend and API routes.
- AI provider routing supports Gemini free tier and Claude when API credits exist.
- GitHub tools can list files, read files, write files, and commit.
- Push reminders use service worker, VAPID, Vercel KV, and a GitHub Actions cron ping.

Important repos:
- Mobile: https://github.com/oksoimcodingnow/atlas-mobile
- VSCode dashboard: https://github.com/oksoimcodingnow/atlas-dashboard
- Example target repo: https://github.com/oksoimcodingnow/roshop

Safety priorities:
- Never commit real API keys or tokens.
- Prefer reviewed/PR-style flows before allowing broad automated commits.
- Keep changes understandable for a React beginner.
- Preserve the repo as a learning artifact, not just a working app.

Current known 95 percent line:
- The architecture exists.
- Some external setup may still need final testing: Gemini key, Vercel env vars, Web Push, cron reminders.
- Do not pretend unverified production behavior is complete.

