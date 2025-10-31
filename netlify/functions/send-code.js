// netlify/functions/send-code.js

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

export default async (req, context) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const { email, name, rank, income, expenses, projected_mortgage } = await req.json();

    if (!email || !name || !rank) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

    const { error } = await supabase.from('email_codes').insert([{
      email,
      code_hash: codeHash,
      name,
      rank,
      income,
      expenses,
      projected_mortgage,
      status: 'active',
      created_at: new Date().toISOString(),
      expires_at: expiresAt
    }]);

    if (error) {
      console.error('Supabase error:', error);
      return new Response(JSON.stringify({ error: 'Database insert failed' }), { status: 500 });
    }

    const lastName = name.split(' ').pop();

    // -- FULL HTML EMAIL --
    const html = `
<!DOCTYPE html>
<html lang="en" style="margin:0; padding:0;">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your OrozcoRealty Code</title>
  </head>
  <body style="margin:0; padding:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:#f4f4f7; color:#333;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 40px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.05);">
            <tr>
              <td style="padding: 40px 40px 20px;">
                <h2 style="margin: 0; color: #1d352c; font-weight: 700;">Welcome to The Orozco Realty</h2>
                <p style="font-size: 16px; margin: 20px 0 0 0;">
                  Hi <strong>${rank} ${lastName}</strong>,
                </p>
                <p style="font-size: 16px; margin: 10px 0 20px 0;">
                  Your unique verification code for <strong>OrozcoRealty</strong> is:
                </p>
                <div style="background: #f3f4f6; padding: 20px; text-align: center; font-size: 30px; font-weight: bold; letter-spacing: 4px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                  ${code}
                </div>
                <p style="font-size: 13px; margin-top: 20px; color: #777;">
                  Please safeguard this code and do not share it with anyone.<br />
                  This code expires in <strong>10 minutes</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 40px 0; border-top: 1px solid #eee;">
                <table role="presentation" width="100%" style="margin-top: 20px;">
                  <tr>
                    <td width="80" valign="top">
                      <img src="https://cdn.prod.website-files.com/68cecb820ec3dbdca3ef9099/690045801fe6ec061af6b131_1394a00d76ce9dd861ade690dfb1a058_TOR-p-2600.png" width="60" style="border-radius: 6px;" alt="Orozco Realty logo" />
                    </td>
                    <td valign="top" style="padding-left: 10px;">
                      <p style="margin: 0; font-weight: 500;">Sincerely Yours,</p>
                      <p style="margin: 0; font-style: italic;">Elena<br />“A.I. Concierge”</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 30px 40px 40px;">
                <p style="font-size: 12px; color: #999; margin: 0;">
                  SaSS™ — Naughty Realty, Serious Returns<br />
                  © 2025 The Orozco Realty. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `Your OrozcoRealty ID is Ready, ${rank} ${lastName} 🔐`,
      html
    });

    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });

  } catch (err) {
    console.error('Server Error:', err);
    return new Response(JSON.stringify({ error: 'Unexpected error' }), { status: 500 });
  }
};
