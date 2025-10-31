// netlify/functions/send-code.js
// Option 1 data model (context jsonb)

import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

//-----------------------------------------
// #1 CORS headers we ALWAYS send
//-----------------------------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json"
};

// helper to respond with JSON safely
function respond(status, bodyObj) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: CORS_HEADERS,
  });
}

//-----------------------------------------
// #2 hash the verification code (SHA-256)
//-----------------------------------------
async function hashCode(code) {
  const enc = new TextEncoder().encode(code);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

//-----------------------------------------
// #3 main handler
//-----------------------------------------
export async function handler(event) {
  // Support browser preflight
  if (event.httpMethod === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS_HEADERS });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  try {
    // Parse request body
    const body = JSON.parse(event.body || "{}");
    const email = (body.email || "").trim();
    const rank = body.rank || "";          // e.g. "Major"
    const lastName = body.lastName || "";  // e.g. "Orozco"
    const phone = body.phone || "";        // e.g. "956..."
    // NOTE: we are not storing passcode separately right now

    if (!email) {
      return respond(400, { error: "Missing email" });
    }

    //---------------------------------
    // Generate a 6-digit code
    //---------------------------------
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const code_hash = await hashCode(code);

    // Expire in 10 minutes
    const now = new Date();
    const expires = new Date(now.getTime() + 10 * 60 * 1000);

    //---------------------------------
    // Supabase client (service role)
    //---------------------------------
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    //---------------------------------
    // Insert row into email_codes
    // Matches Option 1 table shape:
    // email, code_hash, attempts, expires_at, created_at, context(jsonb)
    //---------------------------------
    const { error: dbError } = await supabase
      .from("email_codes")
      .insert([
        {
          email: email,
          code_hash: code_hash,
          attempts: 0,
          expires_at: expires.toISOString(),
          created_at: now.toISOString(),
          context: {
            rank: rank,
            last_name: lastName,
            phone: phone
          }
        }
      ]);

    if (dbError) {
      console.error("Supabase insert failed:", dbError);
      return respond(500, { error: "DB insert failed." });
    }

    //---------------------------------
    // Send the email via Resend
    //---------------------------------
    const resend = new Resend(process.env.RESEND_API_KEY);

    // We’ll address them by rank + last name if we have it
    const displayNameParts = [];
    if (rank) displayNameParts.push(rank);
    if (lastName) displayNameParts.push(lastName);
    const greetingName = displayNameParts.length
      ? displayNameParts.join(" ")
      : "there";

    await resend.emails.send({
      from: "RealtySaSS <no-reply@theorozcorealty.netlify.app>",
      to: [email],
      subject: "Your RealtySaSS Verification Code",
      html: `
        <p>Hi ${greetingName},</p>
        <p>Your verification code is: <strong>${code}</strong></p>
        <p>It expires in 10 minutes.</p>
      `.trim()
    });

    //---------------------------------
    // Success back to browser
    //---------------------------------
    return respond(200, { ok: true });

  } catch (err) {
    console.error("send-code fatal error:", err);
    return respond(500, { error: "Internal error" });
  }
}
