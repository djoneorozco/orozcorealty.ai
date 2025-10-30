//#2 verify-code.js — FULL FILE

import { createClient } from "@supabase/supabase-js";

async function hashCode(code) {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin"
    }
  });
}

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin"
      }
    });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // 1. parse body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse({ error: "Bad JSON" }, 400);
  }

  const { email, code } = body;
  if (!email || !code) {
    return jsonResponse({ error: "Missing email or code" }, 400);
  }

  // 2. init supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  // 3. get stored row for this email
  const { data: row, error: selErr } = await supabase
    .from("email_codes")
    .select("*")
    .eq("email", email)
    .single();

  if (selErr || !row) {
    // nothing on record
    return jsonResponse({ error: "Invalid code." }, 400);
  }

  // 4. check expiration
  const now = Date.now();
  const deadline = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (!deadline || now > deadline) {
    return jsonResponse({ error: "Code expired." }, 400);
  }

  // 5. compare hashes
  const providedHash = await hashCode(code);
  if (providedHash !== row.code_hash) {
    // bump attempts to track abuse (optional)
    await supabase
      .from("email_codes")
      .update({ attempts: (row.attempts || 0) + 1 })
      .eq("email", email);

    return jsonResponse({ error: "Invalid code." }, 400);
  }

  // (Optional) you can clear the code here so it can't be reused:
  // await supabase.from("email_codes").delete().eq("email", email);

  // 6. success -> this is where we "unlock" the app
  return jsonResponse({
    ok: true,
    redirect: "/features/analyze",
    identity: {
      email: row.email,
      ...row.context // rank / lastName / phone you stored
    }
  });
}
