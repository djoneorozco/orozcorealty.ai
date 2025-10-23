// ============================================================
// RealtySaSS — send-code.js  (Blobs-Optional • FULL FILE)
// - Sends code via Resend (email) or Twilio (SMS, optional)
// - Uses Netlify Blobs if available; otherwise skips storage
// ============================================================

import { createHash } from 'crypto';
import { Resend } from 'resend';

const CODE = '123456';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v || '');
const isPhone = (v) => /^\+?[0-9]{7,15}$/.test((v || '').replace(/\s+/g, ''));

// Try loading Netlify Blobs store only if the environment supports it
async function tryGetStore() {
  try {
    // These env vars are injected when Blobs is enabled
    if (!process.env.NETLIFY_BLOBS_CONTEXT || !process.env.NETLIFY_BLOBS_URL) return null;
    const { getStore } = await import('@netlify/blobs');
    return await getStore({ name: 'email-codes' });
  } catch {
    return null;
  }
}

const HAS_TWILIO =
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_AUTH_TOKEN &&
  !!process.env.TWILIO_FROM_NUMBER;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
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
      HAS_BLOBS_ENV: !!process.env.NETLIFY_BLOBS_CONTEXT,
    });

    if (!email && !phone) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Provide email or phone.' }) };
    }
    if (email && !isEmail(email)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid email format.' }) };
    }
    if (!email && phone && !isPhone(phone)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid phone format.' }) };
    }

    // Store code if Blobs is available; otherwise log and continue (fallback)
    const store = await tryGetStore();
    if (store) {
      const principal = (email || phone).toLowerCase();
      const key = `code:${principal}`;
      const record = {
        hash: sha256(CODE),
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0,
        channel: email ? 'email' : 'sms',
      };
      await store.set(key, JSON.stringify(record));
      console.log('send-code: stored code record for', key);
    } else {
      console.warn('send-code: Blobs not available — skipping storage (dev fallback).');
    }

    // === Email via Resend ===
    if (email) {
      if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
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
          body: JSON.stringify({ error: `Email send failed: ${e?.message || 'Unknown error'}` }),
        };
      }
    }

    // === SMS via Twilio (optional) ===
    if (!email && phone) {
      if (!HAS_TWILIO) {
        console.warn('send-code: Twilio not configured; returning ok (dev mode)');
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, note: 'SMS not configured.' }) };
      }
      try {
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
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: `SMS send failed: ${e?.message || 'Unknown error'}` }) };
      }
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('send-code: unhandled error', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err?.message || 'Failed to send code' }) };
  }
};
