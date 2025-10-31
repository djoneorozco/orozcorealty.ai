//#1 imports
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

//#2 env
const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// helper: make a random 6-digit string
function makeCode() {
  // always 6 digits, padded
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// helper: hash the code before storing
async function hashCode(code) {
  // lightweight hash just so we’re not storing raw code.
  // crypto.subtle lives in the edge runtime so we keep it Node-friendly:
  const enc = new TextEncoder().encode(code);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

// helper: small JSON response with proper headers (SO THIS NEVER 502s)
function jsonResponse(status, bodyObj) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: {
      "Content-Type": "application/json",
      // CORS headers so browser stops yelling
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

//#3 the handler
export async function handler(event) {
  // Handle preflight
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
    // parse the body
    const { email, rank, lastName, phone } = JSON.parse(event.body || "{}");

    if (!email) {
      return jsonResponse(400, { error: "Email required" });
    }

    // 1. generate and hash code
    const codePlain = makeCode();        // e.g. "478182"
    const codeHash = await hashCode(codePlain);

    // 2. build row for DB
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
    const ctx = {
      rank: rank || "",
      lastName: lastName || "",
      phone: phone || "",
    };

    // 3. insert into Supabase
    const { error: dbErr } = await supabase
      .from("email_codes")
      .insert([
        {
          email,
          code_hash: codeHash,
          attempts: 0,
          expires_at: expiresAt,
          context: ctx,
        },
      ]);

    if (dbErr) {
      console.error("Supabase insert failed:", dbErr);
      return jsonResponse(500, { error: "DB insert failed" });
    }

    // 4. send email with Resend
    const { error: mailErr } = await resend.emails.send({
      from: process.env.FROM_EMAIL, // must be verified domain in Resend
      to: email,
      subject: "Your RealtySaSS verification code",
      text: [
        `Hi ${rank ? rank + " " : ""}${lastName || ""},`,
        ``,
        `Your verification code is: ${codePlain}`,
        ``,
        `It expires in 10 minutes.`,
      ].join("\n"),
    });

    if (mailErr) {
      console.error("Resend failed:", mailErr);
      return jsonResponse(500, { error: "Email send failed" });
    }

    // 5. success
    return jsonResponse(200, { ok: true, sent: true });
  } catch (err) {
    console.error("send-code crashed:", err);
    return jsonResponse(500, { error: "Server error" });
  }
}
