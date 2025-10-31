// netlify/functions/send-code.js
//
// PURPOSE:
// - Accept POST { email, rank, lastName, phone }
// - Generate 6-digit code
// - Hash code (never store raw code)
// - Insert row into Supabase (email_codes table)
// - Send code via Resend email
// - Return {ok:true}
//
// ENV VARS (Netlify):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY     <-- you kept this name
//   RESEND_API_KEY
//   EMAIL_FROM or FROM_EMAIL (either works)
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
// NOTE: We do not return the code to the browser.

const crypto = require("crypto");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

// uniform HTTP response helper
function respond(statusCode, payloadObj) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payloadObj || {})
  };
}

// make a random 6-digit numeric code like "478182"
function makeCode() {
  const n = crypto.randomInt(0, 1000000); // 0..999999
  return n.toString().padStart(6, "0");
}

// sha256 hash so we never store the raw code
function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

exports.handler = async function (event, context) {
  // 0. Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return respond(200, {});
  }

  // 1. Only allow POST
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  // 2. Parse body
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

  // 3. Generate code + expiration timestamp (10 min)
  const code = makeCode(); // e.g. "478182"
  const code_hash = hashCode(code);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // 4. Supabase client (service key so we can insert securely)
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });

  // 5. Insert code row
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

  // 6. Send email via Resend
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress =
    process.env.EMAIL_FROM ||
    process.env.FROM_EMAIL ||
    "RealtySaSS <noreply@example.com>";

  const resend = new Resend(resendKey);

  const subject = "Your RealtySaSS Verification Code";
  const textBody = `Hi ${rank ? rank + " " : ""}${lastName || ""},

Your verification code is: ${code}

It expires in 10 minutes.
`;

  try {
    await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject,
      text: textBody
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    // Code is already stored in DB, so we just surface that email failed
    return respond(500, { error: "Email send failed" });
  }

  // 7. Success
  return respond(200, {
    ok: true,
    message: "Code created, stored, and emailed."
  });
};
