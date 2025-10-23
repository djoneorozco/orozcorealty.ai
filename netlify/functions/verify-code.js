// ============================================================
// RealtySaSS — verify-code.js  (Blobs-Optional • FULL FILE)
// - Verifies code against stored hash if Blobs exists
// - Falls back to direct match (123456) if Blobs is not enabled
// ============================================================

import { createHash } from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};
const CODE = '123456';
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

async function tryGetStore() {
  try {
    if (!process.env.NETLIFY_BLOBS_CONTEXT || !process.env.NETLIFY_BLOBS_URL) return null;
    const { getStore } = await import('@netlify/blobs');
    return await getStore({ name: 'email-codes' });
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, phone, code } = JSON.parse(event.body || '{}');
    const principal = (email || phone || '').toLowerCase();
    if (!principal || !code) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing email/phone or code' }) };
    }

    const store = await tryGetStore();

    // If Blobs exists, check stored hash + expiry + attempts
    if (store) {
      const key = `code:${principal}`;
      const raw = await store.get(key);
      if (!raw) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No code on record. Request a new one.' }) };
      }
      const data = JSON.parse(raw);
      const now = Date.now();
      if (now > (data.expiresAt || 0)) {
        await store.delete(key);
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Code expired. Request a new one.' }) };
      }
      if ((data.attempts || 0) >= 10) {
        await store.delete(key);
        return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'Too many attempts. Request a new code.' }) };
      }

      const ok = sha256(String(code)) === data.hash;
      if (!ok) {
        data.attempts = (data.attempts || 0) + 1;
        await store.set(key, JSON.stringify(data));
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid code' }) };
      }

      await store.delete(key);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // Fallback (no Blobs): accept the fixed code
    if (String(code) === CODE) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, note: 'Verified without Blobs (dev).' }) };
    }
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid code' }) };
  } catch (err) {
    console.error('verify-code: unhandled error', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err?.message || 'Verification failed' }) };
  }
};
