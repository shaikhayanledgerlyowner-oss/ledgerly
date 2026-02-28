import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

async function getRawBody(req: VercelRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL; // ✅ server env only
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Missing server env vars" });
  }

  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  if (!signature) return res.status(400).json({ error: "Missing signature" });

  // ✅ RAW body (must)
  const rawBody = await getRawBody(req);

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (expected !== signature) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = JSON.parse(rawBody);
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
