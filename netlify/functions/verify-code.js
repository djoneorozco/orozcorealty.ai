// verify-code.js  (goes in netlify/functions/)
import { createHash } from 'crypto';

const sha256 = (s) =>
  createHash('sha256').update(s).digest('hex');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase env vars');
  }
  const { createClient } = await import(
    'https://esm.sh/@supabase/supabase-js@2'
  );
  return createClient(url, key);
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};

export const handler = async (event) => {
  // preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({
        error: 'Method not allowed',
      }),
    };
  }

  try {
    const { email, code } = JSON.parse(event.body || '{}');

    if (!email || !code) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error: 'Missing email or code',
        }),
      };
    }

    const supabase = getClient();

    // grab row
    const { data, error: fetchErr } = await supabase
      .from('email_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (fetchErr || !data) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error:
            'No code on record. Please request a new one.',
        }),
      };
    }

    // too many attempts?
    if (data.attempts >= 5) {
      return {
        statusCode: 429,
        headers: cors,
        body: JSON.stringify({
          error: 'Too many attempts.',
        }),
      };
    }

    // expired?
    const now = Date.now();
    const exp = new Date(data.expires_at).getTime();
    if (now > exp) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error: 'Code expired.',
        }),
      };
    }

    // correct code?
    const providedHash = sha256(code);
    const ok = providedHash === data.code_hash;

    // bump attempts
    await supabase
      .from('email_codes')
      .update({
        attempts: data.attempts + 1,
      })
      .eq('email', data.email);

    if (!ok) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error: 'Invalid code.',
        }),
      };
    }

    // success
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        // you can return profile info to stash in localStorage if you want
        context: data.context || null,
      }),
    };
  } catch (err) {
    console.error('verify-code error:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        error:
          err.message || 'Failed to verify code',
      }),
    };
  }
};
