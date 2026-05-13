/**
 * Web Push helpers — server side
 * ==============================
 * Uses the `web-push` library to sign and send push notifications
 * using VAPID (Voluntary Application Server Identification).
 *
 * VAPID is a way to authenticate "this push is from us" without an API key.
 * Each app generates a public/private key pair once. The public key goes to
 * the browser when subscribing; the private key stays on the server and
 * signs every push.
 *
 * Required env vars:
 *   VAPID_PUBLIC_KEY  — base64 string (must match the one the browser used to subscribe)
 *   VAPID_PRIVATE_KEY — base64 string, server-side only
 *   VAPID_SUBJECT     — "mailto:you@example.com" (push services require contact info)
 */
import webpush from "web-push";

export interface PushPayload {
  title?: string;
  body?: string;
  icon?: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

let configured = false;

function configure() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@atlas-mobile.local";
  if (!publicKey || !privateKey) {
    throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export async function sendPush(
  subscription: PushSubscriptionJSON,
  payload: PushPayload,
): Promise<{ ok: true; statusCode: number } | { ok: false; statusCode?: number; error: string }> {
  configure();
  try {
    const res = await webpush.sendNotification(
      subscription as unknown as webpush.PushSubscription,
      JSON.stringify(payload),
    );
    return { ok: true, statusCode: res.statusCode };
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string; body?: string };
    return {
      ok: false,
      statusCode: e.statusCode,
      error: e.body || e.message || String(err),
    };
  }
}
