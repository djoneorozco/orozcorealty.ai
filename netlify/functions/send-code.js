// netlify/functions/send-code.js
// PURPOSE:
// - Accept POST { email, rank, lastName, phone }
// - Check if email already exists in DB
// - If yes: return existing code and ID
// - If no: generate 6-digit code, hash it, insert into DB
// - Send email with code and RealtyID (first 6 chars of UUID)
// - Return { ok: true, code, id }

const crypto = require("crypto");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payloadObj) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payloadObj || {}),
  };
}

function makeCode() {
  const n = crypto.randomInt(0, 1000000);
  return n.toString().padStart(6, "0");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return respond(200, {});
  if (event.httpMethod !== "POST")
    return respond(405, { error: "Method not allowed" });

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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress =
    process.env.EMAIL_FROM || "RealtySaSS <noreply@example.com>";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Check if code already exists for this email
  const { data: existingRows, error: fetchErr } = await supabase
    .from("email_codes")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1);

  let code = makeCode();
  let code_hash = hashCode(code);
  let uuid = null;

  if (fetchErr) {
    console.error("Supabase fetch error:", fetchErr);
    return respond(500, { error: "DB read failed" });
  }

  if (existingRows && existingRows.length > 0) {
    uuid = existingRows[0].id;
    const OrozcoID = uuid.slice(0, 6).toUpperCase();

    return respond(200, {
      ok: true,
      message: "Code already exists, no need to resend.",
      orozcoID: OrozcoID,
    });
  }

  // 2. Insert new record
  const now = new Date().toISOString();
  const expiresAt = new Date("2075-01-01T00:00:00Z").toISOString();

  const { data: inserted, error: insertErr } = await supabase
    .from("email_codes")
    .insert([
      {
        email,
        code_hash,
        attempts: 0,
        created_at: now,
        expires_at: expiresAt,
        rank,
        last_name: lastName,
        phone,
        context: { rank, lastName, phone },
      },
    ])
    .select("id");

  if (insertErr || !inserted || !inserted[0]) {
    console.error("Insert error:", insertErr);
    return respond(500, { error: "DB insert failed." });
  }

  uuid = inserted[0].id;
  const OrozcoID = uuid.slice(0, 6).toUpperCase();

  // 3. Send Email
  const resend = new Resend(resendKey);
  const subject = "Your RealtySaSS Verification Code";
  const htmlEmailBody = `
  <html><body><div style="text-align:center;">
    <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/690045801fe6ec061af6b131_1394a00d76ce9dd861ade690dfb1a058_TOR-p-2600.png" width="160" /><br/><br/>
    <h2>Welcome to The Orozco Realty</h2>
    <p>Hi <strong>${rank} ${lastName}</strong>,</p>
    <p>Your verification code is:</p>
    <div style="font-size:32px;font-weight:bold;padding:12px 24px;background:#eaeaea;display:inline-block;border-radius:8px;">${code}</div>
    <p style="margin-top:20px;">Your Realty ID is: <strong>#${OrozcoID}</strong></p>
    <p>Please keep this code safe. Do not share it.</p>
    <br />
    <div style="font-size:13px;text-align:left;margin-top:24px;">
      Sincerely,<br/>
      <strong>Elena</strong><br/>
      <em>"A.I. Concierge"</em><br/>
      <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/68db342a77ed69fc1044ebee_5aaaff2bff71a700da3fa14548ad049f_Landing%20Footer%20Background.png" width="80" />
    </div>
    <br/>
    <div style="font-size:11px;color:#777;text-align:center;">
      SaSS™ — Naughty Realty, Serious Returns<br />
      © 2025 The Orozco Realty. All rights reserved.
    </div>
  </div></body></html>
  `;

  try {
    await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject,
      html: htmlEmailBody,
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    return respond(500, { error: "Email send failed" });
  }

  return respond(200, {
    ok: true,
    message: "Code created, stored, and emailed.",
    orozcoID: OrozcoID,
  });
};
