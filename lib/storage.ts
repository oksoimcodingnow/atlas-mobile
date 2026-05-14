/**
 * STORAGE — thin wrapper around Vercel KV / Upstash Redis
 * =======================================================
 * Reminders and push subscriptions need to survive between serverless function
 * invocations. We can't use a local file (serverless functions are ephemeral)
 * and we can't use env vars (read-only). So we use a managed Redis (Upstash).
 *
 * Vercel auto-injects KV_REST_API_URL and KV_REST_API_TOKEN when you connect
 * a KV / Redis database to the project in the Vercel dashboard.
 *
 * If those env vars are missing, we degrade to a no-op so the app still boots
 * — features that need storage will fail gracefully with a clear error.
 */
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

export function requireRedis(): Redis {
  const r = getRedis();
  if (!r) {
    throw new Error(
      "Storage not configured: missing KV_REST_API_URL / KV_REST_API_TOKEN. " +
        "Set up Vercel KV (Storage tab in the dashboard) and redeploy.",
    );
  }
  return r;
}

// ============================================================================
// REMINDER STORAGE
// ============================================================================

export interface Reminder {
  id: string;            // unique ID
  fireAt: number;        // epoch milliseconds — when to send the push
  message: string;       // the body of the notification
  createdAt: number;
}

const REMINDER_ZSET = "atlas:reminders";          // sorted set, score = fireAt
const REMINDER_HASH_PREFIX = "atlas:reminder:";   // hash per reminder

export async function addReminder(r: Reminder): Promise<void> {
  const kv = requireRedis();
  await kv.zadd(REMINDER_ZSET, { score: r.fireAt, member: r.id });
  await kv.set(REMINDER_HASH_PREFIX + r.id, JSON.stringify(r));
}

export async function fetchDueReminders(now: number): Promise<Reminder[]> {
  const kv = getRedis();
  if (!kv) return [];
  // Get every reminder with score (fireAt) <= now
  const ids = (await kv.zrange(REMINDER_ZSET, 0, now, { byScore: true })) as string[];
  if (!ids.length) return [];
  const raws = await Promise.all(ids.map((id) => kv.get(REMINDER_HASH_PREFIX + id)));
  const reminders: Reminder[] = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = raws[i];
    if (!raw) continue;
    try {
      reminders.push(typeof raw === "string" ? JSON.parse(raw) : (raw as Reminder));
    } catch {
      /* skip malformed */
    }
  }
  return reminders;
}

export async function removeReminder(id: string): Promise<void> {
  const kv = getRedis();
  if (!kv) return;
  await kv.zrem(REMINDER_ZSET, id);
  await kv.del(REMINDER_HASH_PREFIX + id);
}

// Returns ALL pending reminders sorted by fire time ascending.
// Used by /api/reminders and the list_reminders AI tool.
export async function listAllReminders(): Promise<Reminder[]> {
  const kv = getRedis();
  if (!kv) return [];
  // 0 to +Infinity score range = every reminder regardless of fire time
  const ids = (await kv.zrange(REMINDER_ZSET, 0, Number.MAX_SAFE_INTEGER, { byScore: true })) as string[];
  if (!ids.length) return [];
  const raws = await Promise.all(ids.map((id) => kv.get(REMINDER_HASH_PREFIX + id)));
  const reminders: Reminder[] = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = raws[i];
    if (!raw) continue;
    try {
      reminders.push(typeof raw === "string" ? JSON.parse(raw) : (raw as Reminder));
    } catch {
      /* skip malformed */
    }
  }
  return reminders;
}

// ============================================================================
// PUSH SUBSCRIPTION STORAGE
// ============================================================================

const SUB_LIST = "atlas:push_subscriptions";

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  savedAt: number;
}

export async function saveSubscription(sub: StoredSubscription): Promise<void> {
  const kv = requireRedis();
  // Use endpoint as the unique key to avoid duplicates
  await kv.hset(SUB_LIST, { [sub.endpoint]: JSON.stringify(sub) });
}

export async function listSubscriptions(): Promise<StoredSubscription[]> {
  const kv = getRedis();
  if (!kv) return [];
  const all = (await kv.hgetall(SUB_LIST)) as Record<string, string | StoredSubscription> | null;
  if (!all) return [];
  const out: StoredSubscription[] = [];
  for (const v of Object.values(all)) {
    try {
      out.push(typeof v === "string" ? JSON.parse(v) : v);
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const kv = getRedis();
  if (!kv) return;
  await kv.hdel(SUB_LIST, endpoint);
}
