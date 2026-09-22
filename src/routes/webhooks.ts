import { Hono } from "hono";
import { Env } from "../env";
import { verifyScalevSignature, ScalevOrder } from "../lib/scalev";
import { upsertOrders } from "../lib/sync";

export const webhooks = new Hono<{ Bindings: Env }>();

/**
 * Endpoint webhook Scalev: daftarkan URL https://<worker>/api/webhooks/scalev untuk event
 * order.created, order.updated, order.status_changed, order.payment_status_changed.
 */
webhooks.post("/scalev", async c => {
  const raw = await c.req.arrayBuffer();
  if (c.env.SCALEV_WEBHOOK_SECRET) {
    const ok = await verifyScalevSignature(c.env.SCALEV_WEBHOOK_SECRET, raw, c.req.header("X-Scalev-Hmac-Sha256") ?? null);
    if (!ok) return c.text("signature invalid", 401);
  }
  const body = JSON.parse(new TextDecoder().decode(raw)) as { event?: string; data?: ScalevOrder } & ScalevOrder;
  const order = (body.data ?? body) as ScalevOrder;
  if (!order?.id || !order?.order_id) return c.text("ignored", 200);
  // Payload status_changed tidak lengkap; simpan apa yang ada, kolom lain dipertahankan (COALESCE di UPSERT untuk UTM).
  await upsertOrders(c.env, [order]);
  return c.text("ok", 200);
});
