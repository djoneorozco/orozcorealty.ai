//======================================================
// send-code.js  (Netlify Function)
//======================================================

// #1 import deps
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "node:crypto";

// #2 pull secrets from Netlify env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;

// Safety check (helps debug if something is totally missing)
function assertEnv(name, value) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    throw new Error(`Server misconfig: ${name} not set`);
  }
}
assertEnv("SUPABASE_URL", SUPABASE_URL);
assertEnv("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY);
assertEnv("RESEND_API_KEY", RESEND_API_KEY);
assertEnv("FROM_EMAIL", FROM_EMAIL);

// #3 init clients (service role so we can insert)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});
const resend = new Resend(RESEND_API_KEY);

// #4 helper: make a random 6-digit code as a string, zero-padded
function makeCode() {
  const n = crypto.randomInt(0, 1000000); // 0 to 999999
  return n.toString().padStart(6, "0");   // "047812"
}

// #5 hash code before storing (so we're not storing raw in code_hash)
function hashCode(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// #6 build CORS headers for browser + Webflow
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*", // you already opened this in netlify.toml
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

// #7 the handler (Netlify expects a default export with {handler} OR an exported handler fn depending on runtime;
//    in the current Netlify Edge/Functions model with ESM + `type:"module"` you want `export async function handler`.)
export async function handler(event) {
  try {
    // Handle OPTIONS preflight cleanly
    if (event.httpMethod === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (event.httpMethod !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // Parse incoming JSON
    const body = JSON.parse(event.body || "{}");

    // We expect what the front-end is sending (from verify.js):
    // {
    //   email,
    //   rank,
    //   lastName,
    //   phone
    // }
    const email = (body.email || "").trim().toLowerCase();
    const rank = body.rank || "";
    const lastName = body.lastName || "";
    const phone = body.phone || "";

    // basic sanity
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email." }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // Generate code
    const rawCode = makeCode();           // e.g. "478182"
    const codeHash = hashCode(rawCode);   // sha256 hash

    // Expiration = now + 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    // Build row to insert EXACTLY matching your Supabase columns
    // From screenshots, columns are:
    // email (text)
    // code_hash (text)
    // attempts (int4)
    // expires_at (timestamptz)
    // created_at (timestamptz)
    // rank (text)
    // last_name (text)
    // phone (text)
    // passcode (text)
    //
    // NOTE: We're now storing the *raw* code in passcode for you to view,
    // and the hash in code_hash for validation later.
    // If you DON'T want to store raw code in DB long-term, we can drop passcode later.
    const row = {
      email: email,
      code_hash: codeHash,
      attempts: 0,
      expires_at: expiresAt,
      created_at: createdAt,
      rank: rank,
      last_name: lastName,
      phone: phone,
      passcode: rawCode
    };

    // Insert row
    const { error: insertError } = await supabase
      .from("email_codes")
      .insert(row);

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "DB insert failed." }),
        { status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // Send email with Resend
    const subject = "Your RealtySaSS verification code";
    const textBody = [
      `Hi ${rank ? rank + " " : ""}${lastName || ""},`.trim() || "Hello,",
      "",
      `Your verification code is: ${rawCode}`,
      "",
      "It expires in 10 minutes."
    ].join("\n");

    const { error: emailError } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      text: textBody
    });

    if (emailError) {
      console.error("Email send error:", emailError);
      return new Response(
        JSON.stringify({ error: "Email send failed." }),
        { status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    // Success response back to browser
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-code fatal error:", err);
    return new Response(
      JSON.stringify({ error: "Server error." }),
      { status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );
  }
}
