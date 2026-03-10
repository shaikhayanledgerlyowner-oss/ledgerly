// =============================================
// STEP 2: Supabase Edge Function
// File: supabase/functions/send-reminder-emails/index.ts
// 
// Deploy command:
//   supabase functions deploy send-reminder-emails
//
// Environment variables Supabase dashboard mein set karo:
//   RESEND_API_KEY = re_xxxxxxxxxx  (resend.com se free account banao)
// =============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Current time IST (UTC+5:30)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const currentHour = istNow.getUTCHours().toString().padStart(2, "0");
    const currentMinute = istNow.getUTCMinutes().toString().padStart(2, "0");
    const currentTime = `${currentHour}:${currentMinute}`;

    console.log(`Checking reminders for IST time: ${currentTime}`);

    // Enabled reminders jo is waqt fire honi chahiye
    const { data: reminders, error } = await supabase
      .from("reminders")
      .select("user_id, reminder_time, message, email")
      .eq("enabled", true)
      .eq("reminder_time", currentTime);

    if (error) {
      console.error("DB error:", error);
      throw error;
    }

    if (!reminders || reminders.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, time: currentTime, message: "No reminders at this time" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    let sentCount = 0;
    const errors: string[] = [];

    for (const reminder of reminders as any[]) {
      // Email: reminder mein saved email ya profile email use karo
      let recipientEmail = reminder.email;

      // Agar reminder mein email nahi hai, profile se lo
      if (!recipientEmail) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", reminder.user_id)
          .maybeSingle();
        recipientEmail = (profile as any)?.email;
      }

      if (!recipientEmail) {
        console.log(`No email for user ${reminder.user_id}, skipping`);
        continue;
      }

      // Time 12-hour format mein
      const [hStr, mStr] = (reminder.reminder_time || "09:00").split(":");
      let h = parseInt(hStr);
      const m = mStr;
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      const timeLabel = `${h}:${m} ${ampm}`;

      const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ledgerly Reminder</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: #f1f5f9; 
      padding: 24px 16px;
    }
    .wrapper { max-width: 480px; margin: 0 auto; }
    .card { 
      background: white; 
      border-radius: 20px; 
      overflow: hidden;
      box-shadow: 0 4px 32px rgba(0,0,0,0.10);
    }
    .header { 
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); 
      padding: 36px 28px 28px;
      text-align: center;
    }
    .logo-icon {
      width: 56px;
      height: 56px;
      background: rgba(255,255,255,0.15);
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin-bottom: 12px;
    }
    .header h1 { 
      color: white; 
      font-size: 22px; 
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .header p { 
      color: rgba(255,255,255,0.72); 
      font-size: 13px; 
      margin-top: 4px;
    }
    .body { padding: 28px; }
    .time-badge {
      display: inline-block;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 16px;
    }
    .greeting { 
      font-size: 16px; 
      font-weight: 600; 
      color: #0f172a; 
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin-bottom: 20px;
    }
    .message-box { 
      background: linear-gradient(135deg, #eff6ff, #e0f2fe);
      border: 1px solid #bfdbfe;
      border-radius: 12px; 
      padding: 18px 20px; 
      margin-bottom: 24px;
    }
    .message-label {
      font-size: 11px;
      font-weight: 600;
      color: #3b82f6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .message-text { 
      font-size: 16px;
      font-weight: 500;
      color: #1e40af;
      line-height: 1.5;
    }
    .cta-btn { 
      display: block;
      background: linear-gradient(135deg, #1e3a8a, #2563eb); 
      color: white !important; 
      text-decoration: none; 
      padding: 15px 28px; 
      border-radius: 12px; 
      font-weight: 600; 
      font-size: 15px; 
      text-align: center;
      margin-bottom: 16px;
    }
    .tip {
      background: #f8fafc;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 13px;
      color: #475569;
      line-height: 1.6;
    }
    .tip strong { color: #1e293b; }
    .footer { 
      text-align: center; 
      padding: 20px 28px 24px;
      border-top: 1px solid #f1f5f9;
    }
    .footer p { 
      color: #94a3b8; 
      font-size: 12px; 
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo-icon">📒</div>
        <h1>Ledgerly</h1>
        <p>Daily Business Reminder</p>
      </div>
      <div class="body">
        <span class="time-badge">⏰ ${timeLabel}</span>
        <p class="greeting">Aapka daily reminder aa gaya!</p>
        <p class="subtitle">Aaj ka kaam khatam karne ka waqt hai.</p>
        
        <div class="message-box">
          <p class="message-label">📌 Reminder</p>
          <p class="message-text">${reminder.message}</p>
        </div>

        <a href="https://ledgerly.vercel.app/dashboard" class="cta-btn">
          Ledgerly Kholein →
        </a>

        <div class="tip">
          <strong>💡 Tip:</strong> Daily entries rakhne se aapka business record clean rehta hai aur 
          month-end reporting asaan hoti hai.
        </div>
      </div>
      <div class="footer">
        <p>Yeh email isliye aa rahi hai kyunki aapne Ledgerly mein daily reminder set kiya tha.</p>
        <p>Settings → Reminder → disable karke band kar sakte hain.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

      // Resend se email bhejo
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Ledgerly Reminders <reminders@resend.dev>", // Free plan mein yahi use hoga
          to: [recipientEmail],
          subject: `📒 Ledgerly Reminder: ${reminder.message}`,
          html: emailHtml,
        }),
      });

      if (res.ok) {
        sentCount++;
        console.log(`✅ Email sent to ${recipientEmail}`);
      } else {
        const errText = await res.text();
        console.error(`❌ Failed for ${recipientEmail}:`, errText);
        errors.push(`${recipientEmail}: ${errText}`);
      }
    }

    return new Response(
      JSON.stringify({ sent: sentCount, total: reminders.length, time: currentTime, errors }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
