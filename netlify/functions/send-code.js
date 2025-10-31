// netlify/functions/send-code.js
//
// PURPOSE:
// - Accept POST { email, rank, lastName, phone }
// - Generate 6-digit code
// - Hash code (never store raw code)
// - Insert row into Supabase (email_codes table)
// - Send code via Resend email (HTML + text)
// - Return {ok:true}
//
// ENV VARS (Netlify):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   RESEND_API_KEY
//   EMAIL_FROM or FROM_EMAIL
//
// TABLE public.email_codes must include columns:
//   email (text)
//   code_hash (text)
//   attempts (int4)
//   expires_at (timestamptz)
//   created_at (timestamptz default now())
//   rank (text)
//   last_name (text)
//   phone (text)
//   context (jsonb)
//
// CHANGE LOG:
// - Removed 10-min expiration (code never expires)
// - Upgraded HTML email styling with top logo and Elena image in signature

const crypto = require("crypto");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function respond(statusCode, payloadObj) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payloadObj || {})
  };
}

function makeCode() {
  const n = crypto.randomInt(0, 1000000);
  return n.toString().padStart(6, "0");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

exports.handler = async function (event, context) {
  if (event.httpMethod === "OPTIONS") return respond(200, {});
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "Invalid JSON body" });
  }

  const email = (body.email || "").trim().toLowerCase();
  const rank = body.rank || "";
  const lastName = body.lastName || "";
  const phone = body.phone || "";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return respond(400, { error: "Valid email required" });
  }

  const code = makeCode();
  const code_hash = hashCode(code);
  const expires_at = null; // no expiration (permanent OrozcoRealty ID)

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });

  const { error: insertErr } = await supabase
    .from("email_codes")
    .insert([
      {
        email,
        code_hash,
        attempts: 0,
        expires_at,
        rank,
        last_name: lastName,
        phone,
        status: "active",
        context: { rank, lastName, phone }
      }
    ]);

  if (insertErr) {
    console.error("Supabase insert error:", insertErr);
    return respond(500, { error: "DB insert failed." });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress =
    process.env.EMAIL_FROM ||
    process.env.FROM_EMAIL ||
    "RealtySaSS <noreply@example.com>";

  const resend = new Resend(resendKey);
  const subject = `Your Unique OrozcoRealty ID is Ready, ${rank} ${lastName}`;

  const textBody = `Hi ${rank ? rank + " " : ""}${lastName || ""},

Your permanent OrozcoRealty ID is: ${code}

Please keep this code secure — it does not expire.`;

  const htmlEmailBody = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Your OrozcoRealty ID</title>
    <style>
      body {
        background-color: #f9fafb;
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .container {
        max-width: 520px;
        margin: 40px auto;
        background: white;
        border-radius: 10px;
        padding: 40px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      }
      .logo-top {
        display: block;
        margin: 0 auto 24px;
        max-height: 70px;
      }
      h1 {
        font-size: 20px;
        color: #1a1a1a;
        text-align: center;
        margin-bottom: 0.5rem;
      }
      p {
        font-size: 15px;
        color: #333;
        text-align: center;
        margin: 8px 0;
      }
      .code-box {
        margin: 24px auto;
        background: #f0f4f8;
        border-radius: 8px;
        font-size: 30px;
        font-weight: bold;
        letter-spacing: 4px;
        padding: 16px;
        text-align: center;
        color: #1a1a1a;
        width: fit-content;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
      }
      .signature {
        margin-top: 32px;
        text-align: center;
        font-size: 13px;
        color: #333;
      }
      .signature img {
        max-height: 60px;
        display: block;
        margin: 14px auto 0;
        border-radius: 6px;
      }
      .footer {
        font-size: 12px;
        color: #777;
        text-align: center;
        margin-top: 30px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/690045801fe6ec061af6b131_1394a00d76ce9dd861ade690dfb1a058_TOR-p-2600.png" alt="The Orozco Realty" class="logo-top" />
      <h1>Welcome to The Orozco Realty</h1>
      <p><strong>Hi ${rank} ${lastName},</strong></p>
      <p>Your unique OrozcoRealty ID is:</p>
      <div class="code-box">${code}</div>
      <p>Please safeguard this code and do not share it with anyone.<br>
      This code <strong>does not expire</strong>.</p>

      <div class="signature">
        Sincerely Yours,<br />
        <strong>Elena</strong><br />
        <em>"A.I. Concierge"</em><br />
        <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/68db342a77ed69fc1044ebee_5aaaff2bff71a700da3fa14548ad049f_Landing%20Footer%20Background.png" alt="Elena AI Concierge" />
      </div>

      <div class="footer">
        SaSS™ — Naughty Realty, Serious Returns<br />
        © 2025 The Orozco Realty. All rights reserved.
      </div>
    </div>
  </body>
</html>`;

  try {
    await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject,
      text: textBody,
      html: htmlEmailBody
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    return respond(500, { error: "Email send failed" });
  }

  return respond(200, {
    ok: true,
    message: "Permanent code created, stored, and emailed."
  });
};
