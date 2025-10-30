// verify-code.js (TEMP NO-BLOBS VERSION)
import { createHash } from 'crypto';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// IMPORTANT: this must be the SAME memoryStore object as send-code.js
// Easiest way: duplicate the logic here too.
// In real production we'd share a module, but for now we just mirror.
const memoryStore = {};

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
    const { email, code } = JSON.parse(event.body || '{}');
    if (!email || !code) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing email or code' }) };
    }

    const rec = memoryStore[email.toLowerCase()];
    if (!rec) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'No code on record. Please request a new one.' }) };
    }

    const now = Date.now();
    if (now > rec.expiresAt) {
      delete memoryStore[email.toLowerCase()];
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Code expired. Request a new one.' }) };
    }

    if (rec.attempts >= 10) {
      delete memoryStore[email.toLowerCase()];
      return { statusCode: 429, headers: cors, body: JSON.stringify({ error: 'Too many attempts. Request a new code.' }) };
    }

    const ok = sha256(String(code)) === rec.hash;
    if (!ok) {
      rec.attempts = (rec.attempts || 0) + 1;
      memoryStore[email.toLowerCase()] = rec;
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid code' }) };
    }

    // success
    delete memoryStore[email.toLowerCase()];
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err?.message || 'Verification failed' }) };
  }
};
