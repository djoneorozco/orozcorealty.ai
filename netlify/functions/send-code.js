// send-code.js
// FINAL FULL VERSION WITH LOGGING

import { Resend } from 'resend';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'RealtySaSS <no-reply@theorozcorealty.com>';
const ORIGIN = process.env.ORIGIN || 'https://new-real-estate-purchase.webflow.io';
const TTL_MINUTES = 10;

// ✅ Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const six = () => String(Math.floor(100000 + Math.random() * 900000));
const sha256 = s => createHash('sha256').update(s).digest('hex');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin'
};

export const handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { email, rank, lastName, phone } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing email' }) };

    if (!supabaseUrl || !supabaseServiceKey) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Supabase not configured' }) };
    }

    const code = six();
    const hash = sha256(code);
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();

    // 🧠 Try inserting and catch specific errors
    const { error: dbErr } = await supabase
      .from('email_codes')
      .upsert({
        email: email.toLowerCase(),
        code_hash: hash,
        attempts: 0,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      });

    if (dbErr) {
      console.error('Supabase DB error:', dbErr);
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: 'Database write failed', detail: dbErr.message })
      };
    }

    // ✅ Send email
    const subject = `Your RealtySaSS verification code: ${code}`;
    const html = `
      <div style="font-family:Inter,system-ui;line-height:1.6;background:#0b0e1a;color:#e9ecff;padding:24px">
        <p>Hi ${rank ? rank + ' ' : ''}${lastName || 'there'},</p>
        <p>Your one-time verification code for <b>RealtySaSS</b> is:</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:4px;color:#8ef3c5">${code}</p>
        <p>This code expires in ${TTL_MINUTES} minutes.</p>
        <hr style="border:0;border-top:1px solid #2a2f45;margin:24px 0;">
        <p style="font-size:11px;color:#5e6483">${ORIGIN}</p>
      </div>
    `;

    await resend.emails.send({ from: FROM_EMAIL, to: email, subject, html });
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Server error:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message || 'Server failed' }) };
  }
};
