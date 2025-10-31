// #1 Imports / setup
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { Resend } from "resend";

// Netlify function signature (Edge-style compatible with "type": "module")
export default async function handler(req) {
  // #2 CORS preflight support
  if (req.method === "OPTIONS") {
    return corsResponse(200, { ok: true });
  }

  try {
    if (req.method !== "POST") {
      return corsResponse(405, { error: "Method not allowed." });
    }

    // #3 Parse body safely
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return corsResponse(400, { error: "Invalid JSON body." });
    }

    const { email, rank, lastName, phone } = body || {};

    if (!email || typeof email !== "string") {
      return corsResponse(400, { error: "Email required." });
    }

    // #4 Generate 6-digit code
    const code = generateCode(); // string like "478182"

    // #5 Hash code for DB
    const code_hash = hashCode(code);

    // #6 Expiration (10 min from now)
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const created_at = new Date().toISOString();

    // #7 Build identity context we care about (rank, phone, etc)
    const context = {
      rank: rank || "",
      lastName: lastName || "",
      phone: phone || "",
      userAgent: req.headers.get("user-agent") || "",
    };

    // #8 Insert row into Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { error: dbErr } = await supabase
      .from("email_codes")
      .insert([
        {
          email,
          code_hash,
          attempts: 0,
          expires_at,
          created_at,
          context, // this column must be jsonb in Supabase
        },
      ]);

    if (dbErr) {
      console.error("Supabase insert error:", dbErr);
      return corsResponse(500, { error: "DB insert failed." });
    }

    // #9 Send email via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);

    const msg = {
      from: process.env.FROM_EMAIL, // e.g. "RealtySaSS <noreply@yourdomain>"
      to: [email],
      subject: "Your RealtySaSS verification code",
      html: `
        <p>Hi ${rank ? rank + " " : ""}${lastName || ""},</p>
        <p>Your verification code is: <b>${code}</b></p>
        <p>It expires in 10 minutes.</p>
      `,
    };

    const { error: emailErr } = await resend.emails.send(msg);
    if (emailErr) {
      console.error("Resend error:", emailErr);
      return corsResponse(500, { error: "Email send failed." });
    }

    // #10 Return success
    return corsResponse(200, {
      ok: true,
      message: "Code sent.",
      expires_at,
    });
  } catch (err) {
    console.error("Unhandled send-code error:", err);
    return corsResponse(500, { error: "Server error." });
  }
}

// #A helper: make 6-digit code
function generateCode() {
  // crypto.randomInt(0, 1000000) gives 0..999999
  const n = crypto.randomInt(0, 1000000);
  return n.toString().padStart(6, "0");
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
      // CORS allow all for now
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

// Netlify edge/runtime compatibility
export const config = {
  path: "/api/send-code",
};
