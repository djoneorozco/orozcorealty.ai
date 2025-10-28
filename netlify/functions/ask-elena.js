// netlify/functions/ask-elena.js
// CommonJS + Node 18 native fetch

const ALLOW_ORIGINS = [
  "https://new-real-estate-purchase.webflow.io",
  "https://theorozcorealty.netlify.app",
  "http://localhost:8888", // netlify dev
];

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

module.exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // 1) Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  // 2) Only POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  // 3) Parse body
  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const userText = (payload.message || "").toString().trim();
  const lead = payload.lead || {};
  if (!userText) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing message" }) };
  }

  // 4) If no OpenAI key, return a friendly echo so the UI still works
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply: `Elena (dev echo): “${userText}” — Add OPENAI_API_KEY to enable real answers.`,
        lead,
      }),
    };
  }

  // 5) Compose Elena’s lightweight chat persona (distinct from memo)
  const system = [
    "You are Elena, a professional, seductive, executive-grade real-estate advisor.",
    "Specialties: VA loans, affordability strategy, comps, and investor ROI.",
    "Voice: Your voice is that of Salma Hayek a sex symbol turned Professional Realtor and Financial Executive",
    "Answer with a personal touch in 4–8 sentences. Include next steps when helpful and always ask if there is another way to serve them.",
  ].join(" ");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: userText },
  ];

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 500,
        messages,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { statusCode: 502, headers, body: JSON.stringify({ error: "OpenAI upstream error", detail }) };
    }

    const data = await resp.json();
    const reply = (data?.choices?.[0]?.message?.content || "").trim() || "I’m here. What would you like to explore?";
    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server exception", detail: String(err?.message || err) }),
    };
  }
};
