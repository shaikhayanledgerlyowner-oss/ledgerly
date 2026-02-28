import type { VercelRequest, VercelResponse } from "@vercel/node";
import Razorpay from "razorpay";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional: quick check in browser
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/create-order" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({
      error: "Missing Razorpay env variables",
      missing: {
        RAZORPAY_KEY_ID: !keyId,
        RAZORPAY_KEY_SECRET: !keySecret,
      },
    });
  }

  try {
    const body = req.body || {};
    const amountRaw = body.amount;
    const currencyRaw = body.currency;
    const notesRaw = body.notes;

    const amount = Number(amountRaw);

    // amount is in paise, must be integer >= 1
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "Amount is required and must be a positive number (in paise)",
        got: amountRaw,
      });
    }

    const amountInt = Math.round(amount);

    const currency =
      typeof currencyRaw === "string" && currencyRaw.trim()
        ? currencyRaw.trim().toUpperCase()
        : "INR";

    const notes =
      notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)
        ? notesRaw
        : {};

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const order = await razorpay.orders.create({
      amount: amountInt,
      currency,
      receipt: `rcpt_${Date.now()}`,
      notes,
    });

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err: any) {
    // Razorpay errors often have: err.statusCode, err.error (object)
    console.error("Create order error:", err);

    const status = err?.statusCode || err?.status || 500;
    const message =
      err?.error?.description ||
      err?.error?.reason ||
      err?.message ||
      "Order creation failed";

    return res.status(status).json({
      error: message,
      razorpay: err?.error || null,
    });
  }
}
