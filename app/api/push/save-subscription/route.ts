/**
 * POST /api/push/save-subscription
 * ================================
 * Persists a push subscription to KV so the cron job can fire pushes
 * to this device even when ATLAS isn't open.
 *
 * Body shape:
 *   { subscription: { endpoint, keys: { p256dh, auth } } }
 */
import { saveSubscription, StoredSubscription } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { subscription?: StoredSubscription };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sub = body.subscription;
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return Response.json(
      { ok: false, error: "Missing subscription { endpoint, keys: { p256dh, auth } }" },
      { status: 400 },
    );
  }

  try {
    await saveSubscription({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      savedAt: Date.now(),
    });
    return Response.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
