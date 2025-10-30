 // netlify/functions/send-code.js
// RealitySaSS • Send Verification Code
// POST { email, rank, lastName, phone }

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const ALLOWED_ORIGIN = "https://new-real-estate-purchase.webflow.io"; // <-- your live Webflow site
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Helper: build CORS headers (we return this on every response)
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

// Helper: quick JSON response with proper headers
function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  };
}

// hashCode -> sha256(code + email) so we never store the raw code
function hashCode(email, code) {
  return crypto
    .createHash("sha256")
    .update(email + ":" + code)
    .digest("hex");
}

// generate 6-digit numeric code, zero padded
function generateCode() {
  const n = Math.floor(Math.random() * 1000000); // 0..999999
  return String(n).padStart(6, "0");
}

// HTML email body (you can style more later)
function buildEmailHTML({ code, rank, lastName }) {
  const greeting = rank || lastName ? `Hi ${rank ? rank + " " : ""}${lastName || ""},` : "Hi there,";
  return `
    <div style="font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Inter', Roboto, Arial, sans-serif; line-height:1.5; color:#fff; background:#0b0e1a; padding:24px;">
      <div style="max-width:480px; margin:0 auto; background:#151a2d; border:1px solid #2a304d; border-radius:12px; padding:24px;">
        <h2 style="margin:0 0 12px; font-size:16px; font-weight:600; color:#8ef3c5;">
          Your RealtySaSS verification code
        </h2>
        <p style="margin:0 0 16px; font-size:14px; color:#c9ceef;">
          ${greeting}
        </p>
        <p style="margin:0 0 16px; font-size:14px; color:#c9ceef;">
          Your one-time verification code for RealtySaSS is:
        </p>
        <div style="font-size:28px; font-weight:700; letter-spacing:4px; color:#ffffff; background:#0f1324; border:1px solid #2a304d; border-radius:8px; padding:16px; text-align:center;">
          ${code}
        </div>
        <p style="margin:16px 0 0; font-size:12px; color:#6970a8;">
          This code expires in 10 minutes.
        </p>
      </div>
      <div style="max-width:480px; margin:16px auto 0; font-size:11px; color:#4b4f75; text-align:center;">
        SaSS™ = Naughty Realty, Serious Returns
      </div>
    </div>
  `;
}

export async function handler(event) {
  // 1. Handle preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  // 2. Only allow POST
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // 3. Parse JSON body
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { email, rank = "", lastName = "", phone = "" } = payload;

  if (
    !email ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  ) {
    return jsonResponse(400, { error: "Valid email is required" });
  }

  // 4. Generate code + expiration + hash
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const codeHash = hashCode(email, code);

  // 5. Connect to Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse(500, { error: "Supabase env vars missing" });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 6. Upsert row into email_codes
  // table columns: email (PK), code_hash, attempts, expires_at, created_at
  const { error: dbError } = await supabase
    .from("email_codes")
    .upsert(
      {
        email,
        code_hash: codeHash,
        attempts: 0,
        expires_at: expiresAt,
        // created_at: default now() in DB
      },
      { onConflict: "email" }
    );

  if (dbError) {
    return jsonResponse(500, { error: "Failed to save code." });
  }

  // 7. Send email using Resend
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  if (!resendApiKey || !fromEmail) {
    return jsonResponse(500, { error: "Email service env vars missing" });
  }

  const resend = new Resend(resendApiKey);

  const subject = "Your RealtySaSS verification code: " + code;
  const htmlBody = buildEmailHTML({
    code,
    rank,
    lastName,
  });

  try {
    await resend.emails.send({
      from: fromEmail,         // e.g. "RealtySaSS <noreply@yourdomain.com>"
      to: email,
      subject,
      html: htmlBody,
    });
  } catch (err) {
    // if email fails, we don't want to leave a valid code behind forever
    // but it *is* already stored with 10-min ttl so user can retry submit again
    return jsonResponse(502, { error: "Failed to send code email." });
  }

  // 8. Return success
  return jsonResponse(200, { ok: true, message: "Code sent." });
}
