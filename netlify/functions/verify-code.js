// Email Verify — VERIFY CODE (ESM, hardened)
// #1 Imports
import { createHash } from 'crypto';
import { getStore } from '@netlify/blobs';

// #2 Helpers
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

// #3 Small util: safe JSON reply
function reply(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(bodyObj || {}),
  };
}

// #4 Handler
export const handler = async (event) => {
  // Handle browser preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: cors,
    };
  }

  // Only allow POST for real work
  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    // 4A. Parse incoming body
    let email = '';
    let code = '';

    try {
      const parsed = JSON.parse(event.body || '{}');
      email = (parsed.email || '').toString().trim().toLowerCase();
      code  = (parsed.code  || '').toString().trim();
    } catch (e) {
      return reply(400, { ok: false, error: 'Bad JSON body' });
    }

    if (!email || !code) {
      return reply(400, { ok: false, error: 'Missing email or code' });
    }

    // 4B. Open blob store
    let store;
    try {
      store = await getStore({ name: 'email-codes' });
    } catch (e) {
      // If blobs not configured / not available, we should NOT 500 silently.
      return reply(500, { ok: false, error: 'Store unavailable (email-codes). Contact admin.' });
    }

    const key = `code:${email}`;

    // 4C. Pull stored code info
    let raw;
    try {
      raw = await store.get(key); // may be null
    } catch (e) {
      return reply(500, { ok: false, error: 'Could not read code store' });
    }

    if (!raw) {
      // nothing stored for this email
      return reply(400, { ok: false, error: 'No code on record. Please request a new one.' });
    }

    // 4D. Parse stored metadata
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // corrupted data, clear it so user can request again
      await store.delete(key).catch(()=>{});
      return reply(400, { ok: false, error: 'Code invalid. Request a new one.' });
    }

    const now = Date.now();

    // 4E. Expired?
    if (now > (data.expiresAt || 0)) {
      await store.delete(key).catch(()=>{});
      return reply(400, { ok: false, error: 'Code expired. Request a new one.' });
    }

    // 4F. Too many attempts?
    if ((data.attempts || 0) >= 10) {
      await store.delete(key).catch(()=>{});
      return reply(429, { ok: false, error: 'Too many attempts. Request a new code.' });
    }

    // 4G. Check hash match
    const match = sha256(code) === data.hash;
    if (!match) {
      // bump attempts and persist
      data.attempts = (data.attempts || 0) + 1;
      await store.set(key, JSON.stringify(data)).catch(()=>{});
      return reply(400, { ok: false, error: 'Invalid code' });
    }

    // 4H. Success — delete record, return ok
    await store.delete(key).catch(()=>{});
    return reply(200, { ok: true });

  } catch (err) {
    // Catch-all safety
    return reply(500, { ok: false, error: err?.message || 'Verification failed' });
  }
};
