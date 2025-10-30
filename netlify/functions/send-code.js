// netlify/functions/send-code.js
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Helper: build a valid Netlify Response
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export default async (req) => {
  const method = req.method || req.httpMethod;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response("", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (method !== "POST") {
    return reply(405, { error: "Method not allowed. Use POST." });
  }

  // Parse JSON body
  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Invalid JSON body." });
  }

  const {
    email,
    rank = "",
    lastName = "",
    phone = "",
    rankPaygrade = "",
  } = body;

  if (!email) {
    return reply(400, { error: "Email is required." });
  }

  // Generate code + hash
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const code_hash = await hashCode(code);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Init Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Save record
  const { error } = await supabase.from("email_codes").upsert(
    {
      email,
      code_hash,
      attempts: 0,
      expires_at,
      context: { rank, lastName, phone, rankPaygrade },
      created_at: new Date().toISOString(),
    },
    { onConflict: "email" }
  );

  if (error) {
    console.error("Supabase error:", error);
    return reply(500, { error: "Database insert failed" });
  }

  // Send email
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: "Your RealtySaSS Verification Code",
      text: `Hi ${rank} ${lastName},

Your verification code is: ${code}

It expires in 10 minutes.`,
    });
  } catch (e) {
    console.error("Email send error:", e);
    return reply(500, { error: "Failed to send verification email" });
  }

  return reply(200, { ok: true, message: "Verification code sent." });
};

// Simple hash for the code (SHA-256)
async function hashCode(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
