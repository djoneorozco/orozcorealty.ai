// netlify/functions/verify-code.js
// RealitySaSS • Verify 6-digit Code
// POST { email, code }

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGIN = "https://new-real-estate-purchase.webflow.io"; // must match send-code.js

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

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

// must be same hashing rule as send-code.js
function hashCode(email, code) {
  return crypto
    .createHash("sha256")
    .update(email + ":" + code)
    .digest("hex");
}

export async function handler(event) {
  // 1. Handle CORS preflight
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

  const { email, code } = payload;

  if (
    !email ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    !code ||
    !/^\d{6}$/.test(code)
  ) {
    return jsonResponse(400, { error: "Email and 6-digit code are required." });
  }

  // 4. Setup Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse(500, { error: "Supabase env vars missing" });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 5. Get row for this email
  const { data: row, error: readErr } = await supabase
    .from("email_codes")
    .select("*")
    .eq("email", email)
    .single();

  if (readErr || !row) {
    return jsonResponse(400, { error: "No code on record. Please request a new one." });
  }

  // row has: code_hash, attempts, expires_at, etc.
  const now = Date.now();
  const exp = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (!exp || now > exp) {
    // expired -> we can optionally clean it up
    await supabase
      .from("email_codes")
      .delete()
      .eq("email", email);
    return jsonResponse(400, { error: "Code expired. Please request a new one." });
  }

  // 6. Compare hashes
  const incomingHash = hashCode(email, code);
  if (incomingHash !== row.code_hash) {
    // wrong code -> bump attempts
    await supabase
      .from("email_codes")
      .update({ attempts: (row.attempts || 0) + 1 })
      .eq("email", email);

    return jsonResponse(401, { error: "Invalid code." });
  }

  // 7. SUCCESS: Code is valid.
  // At this point you can:
  // - delete the entry so it can't be reused
  // - or mark it verified, etc.
  await supabase
    .from("email_codes")
    .delete()
    .eq("email", email);

  // response can include anything you want client-side to use
  // (for example, { verified:true } then JS can redirect to /features/analyze)
  return jsonResponse(200, {
    ok: true,
    verified: true,
    message: "Email verified. Proceed.",
  });
}
