# Push Notifications — Setup Guide

> What to do after pulling v0.0.4. Sets up the schedule + push pipeline so ATLAS can text you reminders on your phone.

If you just want to chat with ATLAS, skip this file — push is optional. Do this only when you're ready to use the **"remind me at 7pm"** feature.

---

## Architecture (one-paragraph)

You tell ATLAS *"remind me at 7pm to study"*. ATLAS uses the `schedule_reminder` tool, which writes the reminder to a Vercel KV (Redis) store. A GitHub Action pings `/api/cron/tick` every minute. The endpoint reads due reminders, sends a Web Push to your saved subscription, and deletes them. Your phone vibrates with the reminder body.

---

## Step 1 — Add Vercel KV (Redis) — ~2 min

1. Open https://vercel.com/protocol-s-projects/atlas-mobile
2. Click the **Storage** tab
3. Click **Create Database** → choose **Marketplace** → **Upstash Serverless DB (Redis-compatible)**
4. Pick a region close to you → **Create**
5. Click **Connect Project** → select `atlas-mobile` → **Connect**

This auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` into your Vercel env. No copy-paste needed.

## Step 2 — Add VAPID + Cron env vars — ~1 min

In https://vercel.com/protocol-s-projects/atlas-mobile/settings/environment-variables, add:

| Variable | Value | What it's for |
|----------|-------|---------------|
| `VAPID_PUBLIC_KEY` | `BCyScOYb6b8zof0uASiGGit3hzOid-h0ZDcwoJqeSFxwppC2Hyiaz4jRuve9CSas4cf0_rIao-cHH6DU1whs7P0` | Browser uses this to subscribe |
| `VAPID_PRIVATE_KEY` | `HQ_Nt4fjwJ5mWHb_No8QtGoB8EbqlBLZ3PY9mwEsf9I` | Server signs push messages with this |
| `VAPID_SUBJECT` | `mailto:hzdjdndb@gmail.com` | Push services require contact info |
| `CRON_SECRET` | (generate one — see below) | Authenticates the cron endpoint |

**Generate `CRON_SECRET`:** any random string. Easy way — in your terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output. Save it somewhere — you need it again in step 3.

> **Want to rotate VAPID keys?** Run `npx web-push generate-vapid-keys` and replace the above values. You'll need to re-subscribe on your phone after rotation.

## Step 3 — Redeploy Vercel — ~30 sec

Env vars only take effect on new deployments. Either:
- Vercel dashboard → Deployments → latest → **⋯** → **Redeploy** (uncheck "use existing build cache"), OR
- `git commit --allow-empty -m "redeploy" && git push`

## Step 4 — Add GitHub Action secrets — ~1 min

The cron tick is triggered by a GitHub Action. It needs two secrets:

1. Open https://github.com/oksoimcodingnow/atlas-mobile/settings/secrets/actions
2. Click **New repository secret** twice:

| Name | Value |
|------|-------|
| `ATLAS_URL` | `https://atlas-mobile-theta.vercel.app` |
| `CRON_SECRET` | (same string from Step 2) |

Now `.github/workflows/cron-tick.yml` will run every minute and ping your `/api/cron/tick` endpoint.

> The Action runs even when your laptop is off — it's GitHub's infrastructure.

## Step 5 — Subscribe your phone — ~30 sec

1. Open https://atlas-mobile-theta.vercel.app on your phone
2. **Add to Home Screen** (iOS Safari: Share → Add to Home Screen; Android Chrome: ⋮ menu → Install app)
3. Open ATLAS from the home screen (NOT from Safari — push only works in the installed PWA on iOS)
4. Tap the **ENABLE** button in the top-right header
5. Approve "Allow notifications"
6. You should immediately get a push: *"Push notifications enabled. You'll get reminders here."*

If you see the push, the pipeline works. 🎉

## Step 6 — Test a real reminder — ~2 min

In ATLAS chat, type:

> *"Remind me in 2 minutes to drink water."*

ATLAS will:
1. Reply briefly that it's scheduled
2. Use the `schedule_reminder` tool (you'll see the green TOOL block)
3. Write the reminder to KV

Wait 2 minutes. Your phone should buzz with a push from ATLAS saying *"drink water"*. ✅

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ENABLE` button doesn't appear | Browser doesn't support push, or you're not in the installed PWA on iOS | Install to home screen, open from the icon |
| Test push doesn't arrive | VAPID env vars not set or Vercel needs redeploy | Check Vercel env vars, then redeploy |
| Reminder schedules but never fires | Cron isn't running, or KV missing | Check `.github/workflows/cron-tick.yml` is running (Actions tab), confirm `CRON_SECRET` matches in both Vercel + GitHub secrets, confirm KV is connected to the Vercel project |
| `Unauthorized` from `/api/cron/tick` | `CRON_SECRET` mismatch | Re-paste the same value in both Vercel env vars AND GitHub Actions secrets |
| iOS push silently fails | Not using installed PWA, or VAPID subject is wrong | Open from home-screen icon; `VAPID_SUBJECT` must start with `mailto:` |
| Push works once, never again | Subscription expired or device uninstalled | Tap ENABLE again to re-subscribe |

---

## What the storage looks like

Vercel KV (Redis) holds two structures:

| Key | Type | Purpose |
|-----|------|---------|
| `atlas:reminders` | Sorted Set (score = unix ms) | "what's due, in order" |
| `atlas:reminder:<id>` | String (JSON) | Full reminder body |
| `atlas:push_subscriptions` | Hash | endpoint → subscription JSON |

The cron tick uses `zrange ... byScore 0 now` to fetch due reminders efficiently. No timer threads, no in-memory state.

---

## Costs

| Resource | Cost |
|----------|------|
| Vercel KV (Upstash Free) | $0 — 256 MB, 100k commands/month |
| GitHub Actions (public repo) | $0 — unlimited minutes on public repos |
| Web Push (browser → device) | $0 |
| **Total push infra** | **$0/month** |

Doesn't matter how many reminders you have — the cron is one HTTP call per minute regardless.

---

## Privacy note

Your reminders live in your own Vercel KV instance. Nobody else can read them — they're tied to your Vercel account.

The push notification body is sent through Apple/Google's push services (FCM, APNS). It's TLS-encrypted in transit and not stored long-term, but technically those companies handle the delivery. Don't put secrets in reminder bodies.
