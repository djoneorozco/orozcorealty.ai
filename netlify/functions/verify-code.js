// Email Verify — SEND CODE (ESM)
// Purpose: create a 6-digit code, save hashed version in Netlify Blobs, (eventually) email it.

import { createHash } from 'crypto';
import { getStore } from '@netlify/blobs';

// ===== helpers =====
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

// generate a zero-padded 6-digit code like "042913"
function generateCode() {
  const n = Math.floor(Math.random() * 1_000_000); // 0 → 999999
  return String(n).padStart(6, '0');
}

export const handler = async (event) => {
  // --- CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }

  // --- only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // --- read request JSON
    const { email, rank, lastName, phone } = JSON.parse(event.body || '{}');

    if (!email) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: 'Missing email' }),
      };
    }

    // --- 1) make code
    const code = generateCode();
    const hash = sha256(code);

    // --- 2) store in Netlify Blobs
    // store name MUST match verify-code.js
    const store = await getStore({ name: 'email-codes' });

    const key = `code:${email.toLowerCase()}`;

    // code valid for 10 minutes
    const expiresAt = Date.now() + 10 * 60 * 1000;

    const record = {
      hash,          // hashed code
      expiresAt,     // timestamp ms
      attempts: 0,   // how many failed tries so far
      // not required for verify, but let's log context so you can inspect blobs later:
      meta: {
        email,
        rank: rank || '',
        lastName: lastName || '',
        phone: phone || '',
        createdAt: new Date().toISOString(),
      },
    };

    await store.set(key, JSON.stringify(record));

    // --- 3) "send" the code
    // Right now we're not actually emailing (you haven't given me a mail API key yet).
    // We'll just log the code to Netlify function logs so you can see it in Netlify dashboard.
    // Later we plug in Resend / SendGrid etc here.
    console.log(`DEBUG verification code for ${email}: ${code}`);

    // --- 4) respond
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true }),
    };

  } catch (err) {
    console.error('send-code fatal:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        error: err?.message || 'Failed to send code',
      }),
    };
  }
};
