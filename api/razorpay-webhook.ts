import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Missing server env vars" });
  }

  const signature = req.headers["x-razorpay-signature"];
  if (!signature) return res.status(400).json({ error: "Missing signature" });

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");

  if (expected !== signature) return res.status(401).json({ error: "Invalid signature" });

  const payload = JSON.parse(body);
  const payment = payload?.payload?.payment?.entity;

  if (!payment) return res.status(200).json({ ok: true, note: "No payment entity" });

  const userId = payment?.notes?.user_id;
  if (!userId) return res.status(200).json({ ok: true, note: "user_id missing in payment.notes" });

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase.from("wallet_transactions").insert({
    user_id: userId,
    razorpay_payment_id: payment.id,
    razorpay_order_id: payment.order_id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    email: payment.email,
    contact: payment.contact,
    description: payment.description,
  });

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
