// netlify/functions/send-code.js
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // Allow only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, rank, lastName, phone } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Missing email address" });
    }

    // Generate 6-digit passcode
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();

    // Expire in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Store in Supabase
    const { error: insertError } = await supabase
      .from("email_codes")
      .upsert({
        email,
        code_hash: passcode, // in production, hash it (crypto.hash)
        attempts: 0,
        expires_at: expiresAt,
        rank: rank || null,
        last_name: lastName || null,
        phone: phone || null,
        passcode, // keep raw for now — secure later
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return res.status(500).json({ error: "Database insert failed" });
    }

    // Send email via Resend
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: "Your RealtySaSS Verification Code",
      html: `<div style="font-family:sans-serif;font-size:16px">
               <p>Hi ${rank ? rank + " " : ""}${lastName || ""},</p>
               <p>Your verification code is:</p>
               <h2 style="color:#4C6FFF">${passcode}</h2>
               <p>This code will expire in 10 minutes.</p>
             </div>`,
    });

    return res.status(200).json({ message: "Code sent successfully" });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
