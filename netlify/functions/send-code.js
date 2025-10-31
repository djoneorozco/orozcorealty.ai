// netlify/functions/send-code.js
//
// PURPOSE:
// - Accept POST { email, rank, lastName, phone }
// - Generate random 6-digit code
// - Hash & store in Supabase (email_codes table)
// - Send branded HTML email via Resend
// - Return { ok: true }
//
// ENV VARS (Netlify):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   RESEND_API_KEY
//   EMAIL_FROM
//
// AUTHOR: OrozcoRealty (Ivy 2.99 Enhanced Edition)

const crypto = require("crypto");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

// ---------- Helpers ----------
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

// ---------- Handler ----------
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

  // --- Generate & store code ---
  const code = makeCode();
  const code_hash = hashCode(code);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return respond(500, { error: "Supabase env not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });

  const { error: insertErr } = await supabase.from("email_codes").insert([
    {
      email,
      code_hash,
      attempts: 0,
      expires_at,
      rank,
      last_name: lastName,
      phone,
      context: { rank, lastName, phone }
    }
  ]);

  if (insertErr) {
    console.error("Supabase insert error:", insertErr);
    return respond(500, { error: "DB insert failed." });
  }

  // --- Prepare Email ---
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress =
    process.env.EMAIL_FROM || "RealtySaSS <noreply@theorozcorealty.com>";
  const resend = new Resend(resendKey);

  const subject = `Your OrozcoRealty ID is Ready, ${rank} ${lastName} 🔐`;

  const textBody = `
Hi ${rank} ${lastName},

Your unique verification code for OrozcoRealty is: ${code}

Please keep this code private.
  `;

  const htmlBody = `
  <div style="background:#f5f7fa;padding:40px 0;font-family:'Inter',Arial,sans-serif;">
    <div style="max-width:620px;margin:auto;background:#ffffff;border-radius:12px;padding:40px 45px;box-shadow:0 8px 30px rgba(0,0,0,0.05);">
      <h2 style="color:#314e41;font-weight:700;margin:0 0 12px;font-size:22px;">Welcome to The Orozco Realty</h2>
      <p style="font-size:16px;color:#111;margin:12px 0;">Hi <strong>${rank} ${lastName}</strong>,</p>
      <p style="font-size:16px;color:#333;margin:12px 0;">
        Your unique verification code for <strong>OrozcoRealty</strong> is:
      </p>

      <div style="background:#f0f2f7;border-radius:10px;padding:25px;text-align:center;
                  font-size:32px;font-weight:800;letter-spacing:3px;color:#1a1a1a;
                  box-shadow:0 0 0 1px #e5e7ec,0 4px 12px rgba(0,0,0,0.06);
                  margin:24px 0;">
        ${code}
      </div>

      <p style="font-size:14px;color:#666;margin:8px 0 20px;">
        Please safeguard this code and do not share it with anyone.<br>
        This code expires in <strong>10 minutes</strong>.
      </p>

      <hr style="border:none;border-top:1px solid #eee;margin:36px 0;" />

      <div style="display:flex;align-items:center;">
        <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/690045801fe6ec061af6b131_1394a00d76ce9dd861ade690dfb1a058_TOR-p-2600.png"
             alt="The Orozco Realty" width="100" height="100"
             style="border-radius:12px;margin-right:20px;">
        <div>
          <p style="margin:0;font-size:15px;color:#222;">Sincerely Yours,</p>
          <p style="margin:3px 0 0;font-weight:600;color:#111;">Elena</p>
          <p style="margin:0;color:#555;font-style:italic;">“A.I. Concierge”</p>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />

      <p style="text-align:center;font-size:12px;color:#888;margin:0;">
        SaSS™ — Naughty Realty, Serious Returns
      </p>
      <p style="text-align:center;font-size:12px;color:#aaa;margin-top:4px;">
        © ${new Date().getFullYear()} The Orozco Realty. All rights reserved.
      </p>
    </div>
  </div>`;

  // --- Send Email ---
  try {
    await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject,
      text: textBody,
      html: htmlBody
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    return respond(500, { error: "Email send failed" });
  }

  return respond(200, { ok: true, message: "Code created, stored, and emailed." });
};
