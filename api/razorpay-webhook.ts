import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Missing server env vars" });
  }

  const signature = req.headers["x-razorpay-signature"];
  if (!signature) {
    return res.status(400).json({ error: "Missing signature" });
  }

  const body =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  // 🔐 Verify Razorpay Signature
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");

  if (expected !== signature) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = JSON.parse(body);
  const payment = payload?.payload?.payment?.entity;

  if (!payment) {
    return res.status(200).json({ ok: true, note: "No payment entity" });
  }

  const userId = payment?.notes?.user_id;
  const plan = (payment?.notes?.plan || "").toLowerCase();

  if (!userId) {
    return res.status(200).json({
      ok: true,
      note: "user_id missing in payment notes",
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ✅ Only success payments activate premium
  const status = (payment.status || "").toLowerCase();
  const successStates = new Set(["captured", "authorized", "paid", "success"]);

  // 1️⃣ Insert into wallet_transactions (ignore duplicate)
  const { error: walletError } = await supabase
    .from("wallet_transactions")
    .upsert(
      {
        user_id: userId,
        razorpay_payment_id: payment.id,
        razorpay_order_id: payment.order_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        email: payment.email,
        contact: payment.contact,
        description: `Ledgerly ${plan || ""} plan`,
      },
      { onConflict: "razorpay_payment_id" }
    );

  if (walletError) {
    console.error(walletError);
    return res.status(500).json({ error: walletError.message });
  }

  // 2️⃣ If payment not successful yet → stop here
  if (!successStates.has(status)) {
    return res.status(200).json({
      ok: true,
      note: "Payment not successful yet",
    });
  }

  // 3️⃣ Calculate premium expiry
  const premiumUntil = new Date();

  if (plan === "monthly") {
    premiumUntil.setMonth(premiumUntil.getMonth() + 1);
  } else if (plan === "yearly") {
    premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
  } else {
    premiumUntil.setDate(premiumUntil.getDate() + 30);
  }

  // 4️⃣ Update profiles table → Premium ON
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      is_premium: true,
      premium_type: plan || null,
      premium_until: premiumUntil.toISOString(),
    })
    .eq("id", userId);

  if (profileError) {
    console.error(profileError);
    return res.status(500).json({ error: profileError.message });
  }

  return res.status(200).json({ ok: true, premiumActivated: true });
}
