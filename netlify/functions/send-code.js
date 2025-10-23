// ============================================================
// RealtySaSS — send-code.js  (FULL FILE)
// - Sends a 6-digit verification code by Email (Resend) or SMS (Twilio)
// - Persists hashed code + 10-minute expiry + attempt counter in Netlify Blobs
// - Netlify-safe (no top-level await)
// - Verbose logs for debugging in Netlify Functions panel
// ============================================================

// //#1 Imports & constants
import { createHash } from 'crypto';
import { getStore } from '@netlify/blobs';
import { Resend } from 'resend';

// Fixed OTP per your request (you can switch to random later)
const CODE = '123456';

// CORS headers (front-end already expects JSON)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};

// Small helpers
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v || '');
const isPhone = (v) => /^\+?[0-9]{7,15}$/.test((v || '').replace(/\s+/g, ''));

// //#2 Twilio config (lazy-loaded inside handler so no top-level await)
const HAS_TWILIO =
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_AUTH_TOKEN &&
  !!process.env.TWILIO_FROM_NUMBER;

// //#3 Handler
export const handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Parse request
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim();
    const phone = (body.phone || '').trim();
    const rank = body.rank || '';
    const lastName = body.lastName || '';

    console.log('send-code: incoming body', {
      email,
      phone,
      rank,
      lastName,
      HAS_RESEND: !!process.env.RESEND_API_KEY,
      HAS_FROM_EMAIL: !!process.env.FROM_EMAIL,
      HAS_TWILIO,
    });

    // Validate input (must have at least one channel)
    if (!email && !phone) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'Provide email or phone.' }),
      };
    }
    if (email && !isEmail(email)) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'Invalid email format.' }),
      };
    }
    if (!email && phone && !isPhone(phone)) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'Invalid phone format. Use E.164, e.g. +12125551234.' }),
      };
    }

    // Persist hashed code with expiry + attempts
    const store = await getStore({ name: 'email-codes' });
    const principal = (email || phone).toLowerCase();
    const key = `code:${principal}`;
    const record = {
      hash: sha256(CODE),
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      attempts: 0,
      channel: email ? 'email' : 'sms',
    };
    await store.set(key, JSON.stringify(record));
    console.log('send-code: stored code record for', key);

    // === Email channel via Resend ===
    if (email) {
      if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
        console.error('send-code: missing email env', {
          RESEND: !!process.env.RESEND_API_KEY,
          FROM_EMAIL: !!process.env.FROM_EMAIL,
        });
        return {
          statusCode: 500,
          headers: CORS,
          body: JSON.stringify({ error: 'Missing email sender configuration (RESEND_API_KEY / FROM_EMAIL).' }),
        };
      }

      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const result = await resend.emails.send({
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

        console.log('send-code: Resend response', result);

        // Resend can return 200 with an { error } object — surface it clearly
        if (result && result.error) {
          return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ error: `Resend error: ${result.error.message || 'Unknown error'}` }),
          };
        }
      } catch (e) {
        console.error('send-code: Resend threw', e);
        return {
          statusCode: 500,
          headers: CORS,
          body: JSON.stringify({ error: `Email send failed: ${e?.message || e || 'Unknown error'}` }),
        };
      }
    }

    // === SMS channel via Twilio (optional) ===
    if (!email && phone) {
      if (!HAS_TWILIO) {
        console.warn('send-code: Twilio not configured; returning ok (dev mode)');
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: true, note: 'SMS not configured; code stored only (dev mode).' }),
        };
      }
      try {
        // Lazy import inside handler (safe; no top-level await)
        const { default: twilio } = await import('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const res = await client.messages.create({
          to: phone,
          from: process.env.TWILIO_FROM_NUMBER,
          body: `Your RealtySaSS verification code is ${CODE}. It expires in 10 minutes.`,
        });
        console.log('send-code: Twilio message SID', res?.sid);
      } catch (e) {
        console.error('send-code: Twilio threw', e);
        return {
          statusCode: 500,
          headers: CORS,
          body: JSON.stringify({ error: `SMS send failed: ${e?.message || e || 'Unknown error'}` }),
        };
      }
    }

    // Success (either email or SMS path)
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('send-code: unhandled error', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err?.message || 'Failed to send code' }),
    };
  }
};
