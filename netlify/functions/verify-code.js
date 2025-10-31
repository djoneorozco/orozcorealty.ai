//#1 imports
import { createClient } from "@supabase/supabase-js";

//#2 env
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// helper: same hash as send-code
async function hashCode(code) {
  const enc = new TextEncoder().encode(code);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

// CORS-aware JSON reply
function jsonResponse(status, bodyObj) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function handler(event) {
  // preflight
  if (event.httpMethod === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const { email, code } = JSON.parse(event.body || "{}");

    if (!email || !code) {
      return jsonResponse(400, { error: "Missing email or code." });
    }

    const hashed = await hashCode(code);

    // Pull the most recent matching row
    const { data, error: dbErr } = await supabase
      .from("email_codes")
      .select("*")
      .eq("email", email)
      .eq("code_hash", hashed)
      .order("created_at", { ascending: false })
      .limit(1);

    if (dbErr) {
      console.error("DB read failed:", dbErr);
      return jsonResponse(500, { error: "DB read failed" });
    }

    if (!data || data.length === 0) {
      return jsonResponse(401, { error: "Invalid code." });
    }

    const row = data[0];

    // check expiry
    const now = Date.now();
    const exp = Date.parse(row.expires_at);
    if (Number.isFinite(exp) && now > exp) {
      return jsonResponse(401, { error: "Code expired." });
    }

    // Passed ✅
    // At this point you can mark them verified, unlock dashboard, redirect, etc.
    // We'll just return success + context we stored.
    return jsonResponse(200, {
      ok: true,
      verified: true,
      context: row.context || {},
    });
  } catch (err) {
    console.error("verify-code crashed:", err);
    return jsonResponse(500, { error: "Server error" });
  }
}
