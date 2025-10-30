// send-code.js (TEMP NO-BLOBS VERSION)
import { Resend } from 'resend';
import { createHash } from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'RealtySaSS <no-reply@theorozcorealty.com>';
const ORIGIN = process.env.ORIGIN || 'https://new-real-estate-purchase.webflow.io';
const TTL_MINUTES = 10;

// -------- TEMP MEMORY STORE (server memory only) --------
const memoryStore = {}; 
// memoryStore[email.toLowerCase()] = { hash, attempts, expiresAt, createdAt, context }

const six = () => String(Math.floor(100000 + Math.random() * 900000));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, phone, rank, lastName } = JSON.parse(event.body || '{}');

    // 1) basic checks
    if (!email) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing email' }) };
    }
    if (!process.env.RESEND_API_KEY) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Missing RESEND_API_KEY' }) };
    }

    // 2) generate code + stash in memory
    const code = six();
    memoryStore[email.toLowerCase()] = {
      hash: sha256(code),
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MINUTES * 60 * 1000,
      context: { rank, lastName, phone },
    };

    // 3) send email
    const subject = `Your RealtySaSS verification code: ${code}`;
    const html = `
      <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
        <p>Hi ${(rank ? `${rank} ` : '')}${lastName || 'there'},</p>
        <p>Your one-time verification code for <strong>RealtySaSS</strong> is:</p>
        <p style="font-size:24px;font-weight:800;letter-spacing:3px">${code}</p>
        <p>This code expires in ${TTL_MINUTES} minutes.</p>
        <hr/><p style="color:#6a6f85;font-size:12px">${ORIGIN}</p>
      </div>`;
    const text = `Your verification code is: ${code}\n\nExpires in ${TTL_MINUTES} minutes.\n${ORIGIN}`;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html,
      text,
    });

    // 4) done
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, ttlMinutes: TTL_MINUTES }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        error: err?.message || 'Failed to send code',
      }),
    };
  }
};
