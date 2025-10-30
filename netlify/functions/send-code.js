//#1 send-code.js — FULL FILE

import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

// helper: tiny hash so we don't save raw code
async function hashCode(code) {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

// util: make JSON Response with CORS headers
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

// preflight for browser
export async function handler(event) {
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

  // 1. parse incoming body
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse({ error: "Bad JSON" }, 400);
  }

  const { email, rank, lastName, phone } = payload;
  if (!email) {
    return jsonResponse({ error: "Missing email" }, 400);
  }

  // 2. generate code and metadata
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const code_hash = await hashCode(code);

  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  const created_at = new Date().toISOString();

  // 3. init Supabase client using service role (server only)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { persistSession: false }
    }
  );

  // 4. upsert row (PK is email, so last code overwrites old code)
  const { error: dbErr } = await supabase
    .from("email_codes")
    .upsert(
      {
        email,
        code_hash,
        attempts: 0,
        expires_at,
        created_at,
        // store identity context for you / CRM
        context: {
          rank: rank || "",
          lastName: lastName || "",
          phone: phone || ""
        }
      },
      { onConflict: "email" }
    );

  if (dbErr) {
    console.error("Supabase upsert failed", dbErr);
    return jsonResponse({ error: "DB write failed" }, 500);
  }

  // 5. send email via Resend
  const resend = new Resend(process.env.RESEND_API_KEY);

  const fromEmail = process.env.FROM_EMAIL || "noreply@yourdomain.com";
  const subject = "Your RealtySaSS verification code";
  const text = `Hi ${rank ? rank + " " : ""}${lastName || ""},

Your verification code is: ${code}

It expires in 10 minutes.`;

  try {
    await resend.emails.send({
      from: fromEmail,
      to: email,
      subject,
      text
    });
  } catch (mailErr) {
    console.error("Email send failed", mailErr);
    return jsonResponse({ error: "Email send failed" }, 502);
  }

  // 6. success
  return jsonResponse({ ok: true });
}
