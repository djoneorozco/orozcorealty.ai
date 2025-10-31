// netlify/functions/send-code.js

const crypto = require("crypto");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

// Helper: respond cleanly
function respond(statusCode, payloadObj) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payloadObj || {})
  };
}

// Helper: generate 6-digit code
function makeCode() {
  const n = crypto.randomInt(0, 1000000);
  return n.toString().padStart(6, "0");
}

// Helper: SHA-256 hash
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

  // Create code (no expiration)
  const code = makeCode();
  const code_hash = hashCode(code);

  // Supabase setup
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });

  // Insert into DB (without expires_at)
  const { error: insertErr } = await supabase.from("email_codes").insert([
    {
      email,
      code_hash,
      attempts: 0,
      rank,
      last_name: lastName,
      phone,
      status: "active",
      context: {
        rank,
        lastName,
        phone
      }
    }
  ]);

  if (insertErr) {
    console.error("Supabase insert error:", insertErr);
    return respond(500, { error: "DB insert failed." });
  }

  // Resend email
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = process.env.EMAIL_FROM || "RealtySaSS <noreply@realtysass.com>";
  const subject = "Your OrozcoRealty# Access Code";

  const htmlBody = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #eee;border-radius:12px;background:#ffffff;">
    <div style="text-align:center;padding-bottom:20px;">
      <h2 style="margin:0;font-weight:600;font-size:24px;color:#333;">OrozcoRealty</h2>
      <p style="font-size:14px;color:#777;margin-top:8px;">Your Private Access Code</p>
    </div>

    <div style="text-align:center;padding:20px 30px;background:#f8f9fa;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
      <p style="font-size:14px;margin:0 0 10px;color:#444;">Your OrozcoRealty# is:</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#2d2d2d;margin:8px 0;">${code}</div>
      <p style="font-size:12px;color:#888;margin-top:10px;">Use this to unlock your tools on RealtySaSS</p>
    </div>

    <div style="margin-top:40px;color:#444;font-size:14px;line-height:1.6;">
      <p>Hi ${rank} ${lastName || ""},</p>
      <p>Thank you for exploring OrozcoRealty. This unique code grants you personal access to our secure client tools.</p>
      <p>If you didn’t request this, feel free to ignore it.</p>
    </div>

    <div style="margin-top:40px;border-top:1px solid #eee;padding-top:16px;text-align:left;">
      <p style="font-size:13px;color:#777;margin:0;">Warm regards,</p>
      <p style="font-size:14px;margin:4px 0;color:#333;"><strong>Elena</strong><br>Your A.I. Concierge</p>
    </div>

    <div style="margin-top:20px;text-align:center;">
      <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/68db342a77ed69fc1044ebee_5aaaff2bff71a700da3fa14548ad049f_Landing%20Footer%20Background.png" width="160" style="opacity:0.85;margin-top:10px;" alt="Elena Image" />
    </div>
  </div>`;

  try {
    await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject,
      html: htmlBody
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    return respond(500, { error: "Email send failed" });
  }

  return respond(200, {
    ok: true,
    message: "Code created, stored, and emailed."
  });
};
