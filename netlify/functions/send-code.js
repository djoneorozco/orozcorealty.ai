// send-code.js  (goes in netlify/functions/)
import { Resend } from 'resend';
import { createHash } from 'crypto';
import { json } from '@netlify/functions';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL =
  process.env.FROM_EMAIL || 'RealtySaSS <no-reply@theorozcorealty.com>';

const ORIGIN =
  process.env.ORIGIN ||
  'https://new-real-estate-purchase.webflow.io';

const TTL_MINUTES = 10;

// helper to make 6-digit code
const six = () =>
  String(Math.floor(100000 + Math.random() * 900000));

const sha256 = (s) =>
  createHash('sha256').update(s).digest('hex');

// create a Supabase client (service role, server only)
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

// CORS headers
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
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { email, phone, rank, lastName } = JSON.parse(
      event.body || '{}'
    );

    if (!email) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: 'Missing email' }),
      };
    }
    if (!process.env.RESEND_API_KEY) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({
          error: 'Missing RESEND_API_KEY',
        }),
      };
    }

    const code = six();
    const codeHash = sha256(code);

    const expiresAt = new Date(
      Date.now() + TTL_MINUTES * 60 * 1000
    ).toISOString();

    // save to Supabase
    const supabase = getClient();
    const { error: dbErr } = await supabase
      .from('email_codes')
      .upsert(
        {
          email: email.toLowerCase(),
          code_hash: codeHash,
          attempts: 0,
          expires_at: expiresAt,
          context: {
            rank,
            lastName,
            phone,
          },
        },
        { onConflict: 'email' }
      );

    if (dbErr) {
      console.error('DB error:', dbErr);
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({
          error: 'DB save failed',
        }),
      };
    }

    // send email
    const subject = `Your RealtySaSS verification code: ${code}`;

    const html = `
      <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#fff;background:#0b0e1a;padding:24px">
        <p>Hi ${rank ? rank + ' ' : ''}${lastName || 'there'},</p>
        <p>Your one-time verification code for <strong>RealtySaSS</strong> is:</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:4px">${code}</p>
        <p style="margin-top:16px">This code expires in ${TTL_MINUTES} minutes.</p>
        <hr style="border-color:#2a2f45;margin:24px 0"/>
        <p style="color:#6a6f85;font-size:12px">${ORIGIN}</p>
      </div>
    `;

    const text = `Your verification code is: ${code}\n\nExpires in ${TTL_MINUTES} minutes.\n${ORIGIN}`;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html,
      text,
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        ttlMinutes: TTL_MINUTES,
      }),
    };
  } catch (err) {
    console.error('send-code error:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        error: err.message || 'Failed to send code',
      }),
    };
  }
};
