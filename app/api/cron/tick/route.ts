/**
 * POST /api/cron/tick
 * ===================
 * Called every minute by a GitHub Action (.github/workflows/cron-tick.yml).
 *
 * Pulls all reminders whose fireAt <= now from KV, sends a push notification
 * to every saved subscription, then deletes the processed reminders.
 *
 * Authenticated by a shared secret in the Authorization header so randoms
 * can't fire pushes to your phone.
 *
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Allows GET too so you can hit it from a browser for debugging.
 */
import {
  fetchDueReminders,
  removeReminder,
  listSubscriptions,
  removeSubscription,
} from "@/lib/storage";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 60;

async function tick(): Promise<{ ok: true; processed: number; sent: number; cleaned: number } | { ok: false; error: string }> {
  const now = Date.now();
  let due = [];
  try {
    due = await fetchDueReminders(now);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "fetchDueReminders failed: " + msg };
  }
  if (!due.length) return { ok: true, processed: 0, sent: 0, cleaned: 0 };

  const subscriptions = await listSubscriptions();
  if (!subscriptions.length) {
    // No one to push to — still drop the due reminders so they don't replay forever.
    await Promise.all(due.map((r) => removeReminder(r.id)));
    return { ok: true, processed: due.length, sent: 0, cleaned: 0 };
  }

  let sent = 0;
  let cleaned = 0;
  const subRemovals: Set<string> = new Set();

  for (const reminder of due) {
    for (const sub of subscriptions) {
      const res = await sendPush(
        { endpoint: sub.endpoint, keys: sub.keys },
        {
          title: "ATLAS Reminder",
          body: reminder.message,
          tag: "atlas-reminder-" + reminder.id,
          url: "/",
          requireInteraction: true,
        },
      );
      if (res.ok) {
        sent++;
      } else if (res.statusCode === 404 || res.statusCode === 410) {
        // The subscription is dead (uninstalled, expired) — clean it up.
        subRemovals.add(sub.endpoint);
      }
    }
    await removeReminder(reminder.id);
  }

  for (const endpoint of subRemovals) {
    await removeSubscription(endpoint);
    cleaned++;
  }

  return { ok: true, processed: due.length, sent, cleaned };
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === "Bearer " + secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await tick();
  return Response.json(result, { status: "ok" in result && result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await tick();
  return Response.json(result, { status: "ok" in result && result.ok ? 200 : 500 });
}
