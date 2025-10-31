// #1 Imports / setup
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req) {
  // #2 Handle preflight
  if (req.method === "OPTIONS") {
    return corsResponse(200, { ok: true });
  }

  try {
    if (req.method !== "POST") {
      return corsResponse(405, { error: "Method not allowed." });
    }

    // #3 Parse body
    let body;
    try {
      body = await req.json();
    } catch (_e) {
      return corsResponse(400, { error: "Invalid JSON body." });
    }

    const { email, code } = body || {};
    if (!email || !code) {
      return corsResponse(400, { error: "Email and code required." });
    }

    // #4 Hash the code they entered
    const code_hash = hashCode(code);

    // #5 Query Supabase for latest code for that email
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // We pull most recent row for that email
    const { data, error: selErr } = await supabase
      .from("email_codes")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1);

    if (selErr) {
      console.error("Supabase select error:", selErr);
      return corsResponse(500, { error: "DB select failed." });
    }

    if (!data || data.length === 0) {
      return corsResponse(400, { error: "Invalid code." });
    }

    const row = data[0];

    // #6 Check expiration
    const now = Date.now();
    const expiresMs = Date.parse(row.expires_at);
    if (isNaN(expiresMs) || now > expiresMs) {
      return corsResponse(400, { error: "Code expired." });
    }

    // #7 Check hash match
    if (row.code_hash !== code_hash) {
      // bump attempts
      const newAttempts = (row.attempts || 0) + 1;
      await supabase
        .from("email_codes")
        .update({ attempts: newAttempts })
        .eq("id", row.id);
      return corsResponse(400, { error: "Invalid code." });
    }

    // #8 SUCCESS: you can mark them trusted, or just respond OK.
    // (Optional future: insert them into 'verified_users' table etc.)
    return corsResponse(200, {
      ok: true,
      message: "Code verified. You’re cleared.",
      identity: row.context || {},
    });
  } catch (err) {
    console.error("Unhandled verify-code error:", err);
    return corsResponse(500, { error: "Server error." });
  }
}

// #B helper: hash code with sha256
function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// #C helper: wrap JSON with CORS headers
function corsResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

export const config = {
  path: "/api/verify-code",
};
