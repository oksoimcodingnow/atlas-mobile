/**
 * GET /api/reminders
 * ==================
 * Returns the list of pending reminders so the UI can show them
 * without going through the AI chat. Used by the REMINDERS panel.
 *
 * DELETE /api/reminders?id=rem_abc — cancel a specific reminder
 *   (used by the X button in the UI list).
 */
import { listAllReminders, removeReminder } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const all = await listAllReminders();
    const now = Date.now();
    const items = all
      .filter((r) => r.fireAt > now - 60_000)
      .sort((a, b) => a.fireAt - b.fireAt)
      .map((r) => ({
        id: r.id,
        fire_at: new Date(r.fireAt).toISOString(),
        fire_at_ms: r.fireAt,
        message: r.message,
        created_at: new Date(r.createdAt).toISOString(),
        seconds_from_now: Math.round((r.fireAt - now) / 1000),
      }));
    return Response.json({ ok: true, reminders: items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return Response.json({ ok: false, error: "Missing ?id query param" }, { status: 400 });
  }
  try {
    await removeReminder(id);
    return Response.json({ ok: true, canceled: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
