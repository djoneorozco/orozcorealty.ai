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
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

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
        context: { rank, lastName, phone }
      }
    ]);

  if (insertErr) {
    console.error("Supabase insert error:", insertErr);
    return respond(500, { error: "DB insert failed." });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress =
    process.env.EMAIL_FROM || process.env.FROM_EMAIL || "RealtySaSS <noreply@example.com>";
  const resend = new Resend(resendKey);

  const subject = "Your Unique OrozcoRealty Verification Code";

  const textBody = `Hi ${rank} ${lastName},

Your verification code is: ${code}

This code expires in 10 minutes.`;

  const htmlBody = `
  <div style="font-family: Arial, sans-serif; background: #f9f9f9; padding: 30px;">
    <div style="max-width: 600px; margin: auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
      <h2 style="color: #3b715b; margin-top: 0;">Welcome to The Orozco Realty:</h2>
      <p style="font-size: 16px; margin: 20px 0;">Hi <strong>${rank} ${lastName}</strong>,</p>
      <p style="font-size: 16px;">Your Unique verification code for <strong>OrozcoRealty</strong> is:</p>

      <div style="background: #f0f2f7; padding: 25px; text-align: center; border-radius: 8px; font-size: 30px; font-weight: bold; letter-spacing: 2px; margin: 20px 0;">
        ${code}
      </div>

      <p style="font-size: 14px; color: #666;">Please safeguard this code and do not share it with anyone.</p>

      <hr style="margin: 40px 0; border: none; border-top: 1px solid #eee;" />

      <div style="display: flex; align-items: center;">
        <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/690045801fe6ec061af6b131_1394a00d76ce9dd861ade690dfb1a058_TOR-p-2600.png" width="100" height="100" style="margin-right: 20px; border-radius: 12px;" alt="The Orozco Realty logo" />
        <div>
          <p style="margin: 0; font-size: 15px;">Sincerely Yours,</p>
          <p style="margin: 5px 0 0; font-weight: bold;">Elena</p>
          <p style="margin: 0;">“A.I. Concierge”</p>
        </div>
      </div>
    </div>
  </div>`;

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

  return respond(200, {
    ok: true,
    message: "Code created, stored, and emailed."
  });
};
