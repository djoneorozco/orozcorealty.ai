// netlify/functions/verify-code.js
//
// PURPOSE:
// - Accept POST { email, code }
// - Check against Supabase email_codes
// - Enforce expiration & attempt limit
// - Return ok / error for UI

const crypto = require("crypto");
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

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

exports.handler = async function (event, context) {
  // 0. CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return respond(200, {});
  }

  // 1. Method check
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
  const codeInput = (body.code || "").trim();

  if (!email || !codeInput || codeInput.length !== 6) {
    return respond(400, { error: "Email and 6-digit code required" });
  }

  // 3. Supabase client
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return respond(500, { error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });

  // 4. Find latest code for this email
  // (you could also do "eq(email)" + "order(created_at.desc).limit(1)")
  const { data: rows, error: selErr } = await supabase
    .from("email_codes")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1);

  if (selErr) {
    console.error("Select error:", selErr);
    return respond(500, { error: "Database error" });
  }

  if (!rows || rows.length === 0) {
    return respond(400, { error: "No code found for this email" });
  }

  const row = rows[0];

  // 5. Check attempts
  if (row.attempts >= 5) {
    return respond(403, { error: "Too many attempts" });
  }

  // 6. Check expiration
  const now = Date.now();
  const exp = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (!exp || now > exp) {
    // increment attempts because it's still basically a failed try
    await supabase
      .from("email_codes")
      .update({ attempts: row.attempts + 1 })
      .eq("email", row.email)
      .eq("created_at", row.created_at);

    return respond(400, { error: "Expired code" });
  }

  // 7. Check hash
  const incomingHash = hashCode(codeInput);

  if (incomingHash !== row.code_hash) {
    // Wrong code: bump attempts
    await supabase
      .from("email_codes")
      .update({ attempts: row.attempts + 1 })
      .eq("email", row.email)
      .eq("created_at", row.created_at);

    return respond(400, { error: "Invalid code" });
  }

  // 8. SUCCESS 🎉
  // You can optionally mark verified, or insert into a "verified_users" table, etc.
  // For now just return ok:true and DO NOT bump attempts.
  return respond(200, {
    ok: true,
    message: "Code verified. User is authenticated/cleared."
  });
};
