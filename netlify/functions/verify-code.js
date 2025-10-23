// Email Verify — VERIFY CODE (ESM)
// Place at: netlify/functions/verify-code.js

import { createHash } from 'crypto';
import { getStore } from '@netlify/blobs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, code } = JSON.parse(event.body || '{}');
    if (!email || !code) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing email or code' }) };
    }

    const store = await getStore({ name: 'email-codes' });
    const key = `code:${email.toLowerCase()}`;
    const raw = await store.get(key);
    if (!raw) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'No code on record. Please request a new one.' }) };
    }

    const data = JSON.parse(raw);
    const now = Date.now();
    if (now > (data.expiresAt || 0)) {
      await store.delete(key);
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Code expired. Request a new one.' }) };
    }

    if (data.attempts >= 10) {
      await store.delete(key);
      return { statusCode: 429, headers: cors, body: JSON.stringify({ error: 'Too many attempts. Request a new code.' }) };
    }

    const ok = sha256(String(code)) === data.hash;
    if (!ok) {
      data.attempts = (data.attempts || 0) + 1;
      await store.set(key, JSON.stringify(data));
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid code' }) };
    }

    await store.delete(key);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err?.message || 'Verification failed' }) };
  }
};
