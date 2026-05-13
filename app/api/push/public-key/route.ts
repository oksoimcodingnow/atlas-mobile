/**
 * GET /api/push/public-key
 * ========================
 * Exposes the VAPID public key to the frontend so it can subscribe
 * via PushManager.subscribe(). The public key is safe to share; the
 * private key stays on the server.
 *
 * We could also expose it as NEXT_PUBLIC_VAPID_PUBLIC_KEY, but going
 * through an endpoint means we can swap the keys without rebuilding.
 */
export const runtime = "nodejs";

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return Response.json({ ok: false, error: "Server missing VAPID_PUBLIC_KEY" }, { status: 500 });
  }
  return Response.json({ ok: true, publicKey: key });
}
