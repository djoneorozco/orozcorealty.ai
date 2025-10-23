// //#1 IMPORTS (no top-level await)
import { createHash } from 'crypto';
import { getStore } from '@netlify/blobs';
import { Resend } from 'resend';
import twilio from 'twilio'; // safe as a static import; no top-level await

// //#2 HELPERS
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};

// Fixed code per your request
const CODE = '123456';

// //#3 OPTIONAL SMS SETUP (no top-level await)
const HAS_TWILIO =
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_AUTH_TOKEN &&
  !!process.env.TWILIO_FROM_NUMBER;

const getTwilioClient = () =>
  HAS_TWILIO
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

// //#4 HANDLER
export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, phone, rank = '', lastName = '' } = JSON.parse(event.body || '{}');

    if (!email && !phone) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Provide email or phone.' }) };
    }

    // Store hashed code with expiry/attempts
    const store = await getStore({ name: 'email-codes' });
    const key = `code:${(email || phone).toLowerCase()}`;
    const payload = {
      hash: sha256(CODE),
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      attempts: 0,
      channel: email ? 'email' : 'sms',
    };
    await store.set(key, JSON.stringify(payload));

    // EMAIL via Resend
    if (email) {
      if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
        return {
          statusCode: 500,
          headers: CORS,
          body: JSON.stringify({ error: 'Email sender not configured (RESEND_API_KEY / FROM_EMAIL).' }),
        };
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: 'Your RealtySaSS verification code',
        html: `
          <div style="font-family:Inter,system-ui,Arial,sans-serif;line-height:1.6;color:#0b0e1a;">
            <h2 style="margin:0 0 8px;">Verify your email</h2>
            <p style="margin:0 0 12px;">${rank && lastName ? `${rank} ${lastName},` : 'Hello,'}</p>
            <p style="margin:0 0 12px;">Your one-time code is:</p>
            <p style="font-size:20px;font-weight:800;letter-spacing:6px;margin:8px 0 16px;">${CODE}</p>
            <p style="margin:0 0 8px;">This code expires in <b>10 minutes</b>.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
            <p style="font-size:13px;color:#6b7280;margin:0;">If you didn’t request this, you can ignore this email.</p>
          </div>
        `,
      });
    }

    // SMS via Twilio (optional)
    if (!email && phone) {
      const client = getTwilioClient();
      if (client) {
        await client.messages.create({
          to: phone,
          from: process.env.TWILIO_FROM_NUMBER,
          body: `Your RealtySaSS verification code is ${CODE}. It expires in 10 minutes.`,
        });
      }
      // If Twilio not configured, still succeed (dev-friendly)
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err?.message || 'Failed to send code' }),
    };
  }
};
