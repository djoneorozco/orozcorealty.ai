// netlify/functions/send-code.js
// #1 FULL FILE

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// helper: build a Netlify-style response
function reply(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // CORS headers (your netlify.toml also does this, but doubling is harmless)
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(bodyObj),
  };
}

// OPTION requests (preflight)
export default async function handler(req) {
  // Netlify gives us req.httpMethod and req.body, not Express req/res.
  const method = req.httpMethod || req.method;

  // Handle CORS preflight fast
  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
      body: "",
    };
  }

  if (method !== "POST") {
    return reply(405, { error: "Method not allowed. Use POST." });
  }

  // Parse incoming JSON
  let payload;
  try {
    payload = JSON.parse(req.body || "{}");
  } catch {
    return reply(400, { error: "Invalid JSON body." });
  }

  const {
    email,
    rank = "",            // ex: "Major"
    lastName = "",        // ex: "Orozco"
    phone = "",           // phone number string
    rankPaygrade = "",    // ex: "O-4"
  } = payload;

  if (!email) {
    return reply(400, { error: "Email is required." });
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // Hash the code before storing (simple hash here; in production you'd bcrypt)
  const code_hash = await simpleHash(code);

  // Expire code in 10 minutes
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Build context so we store identity with the code
  const context = {
    rank,
    rankPaygrade,
    lastName,
    phone,
  };

  // Supabase client (service key! private only on server)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Upsert row for this email
  const { error: dbError } = await supabase
    .from("email_codes")
    .upsert(
      {
        email,
        code_hash,
        attempts: 0,
        expires_at,
        context, // <-- this is a jsonb column we'll add if you haven't already
        created_at: new Date().toISOString(),
      },
      { onConflict: "email" } // so user can request multiple times, we just replace
    );

  if (dbError) {
    console.error("Supabase upsert error:", dbError);
    return reply(500, { error: "DB insert failed.", details: dbError.message });
  }

  // Send email using Resend
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL,           // you already set FROM_EMAIL in Netlify
      to: email,
      subject: "Your RealtySaSS verification code",
      text: `Hi ${rank || ""} ${lastName || ""},

Your one-time verification code for RealtySaSS is:

${code}

This code expires in 10 minutes.

— RealtySaSS`,
    });
  } catch (mailErr) {
    console.error("Resend error:", mailErr);
    return reply(500, { error: "Email send failed." });
  }

  // Success
  return reply(200, {
    ok: true,
    message: "Code sent.",
    // we do NOT send the code back in prod, but we can expose for debug if you really want:
    // debugCode: code,
  });
}

// super-light hash so we're not storing plaintext codes
async function simpleHash(str) {
  const enc = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
