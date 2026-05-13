/**
 * POST /api/push/test
 * ===================
 * Sends a single push notification to a subscription posted in the body.
 * Used by the "Test Notification" button — proves the pipeline works.
 *
 * Body shape:
 *   {
 *     subscription: { endpoint, keys: { p256dh, auth } },
 *     payload?: { title, body, icon, url }
 *   }
 *
 * Returns:
 *   200 { ok: true } on success
 *   400 { ok: false, error } on push service rejection
 *   500 { ok: false, error } on server misconfig
 */
import { sendPush, PushSubscriptionJSON, PushPayload } from "@/lib/push";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { subscription?: PushSubscriptionJSON; payload?: PushPayload };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { subscription, payload } = body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return Response.json(
      { ok: false, error: "Missing subscription { endpoint, keys: { p256dh, auth } }" },
      { status: 400 },
    );
  }

  const result = await sendPush(subscription, {
    title: "ATLAS",
    body: "If you see this, push notifications are working 🎉",
    tag: "atlas-test",
    url: "/",
    ...(payload || {}),
  });

  if (!result.ok) {
    const status = result.statusCode && result.statusCode >= 400 && result.statusCode < 500 ? 400 : 500;
    return Response.json(result, { status });
  }
  return Response.json(result, { status: 200 });
}
