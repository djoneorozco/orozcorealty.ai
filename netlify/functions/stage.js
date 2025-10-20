// netlify/functions/stage.js
// CommonJS, Node 18+ (native fetch)

// ——— CORS ——————————————————————————————————————————
const ALLOW_ORIGINS = [
  "https://new-real-estate-purchase.webflow.io",
  "https://theorozcorealty.netlify.app",
  "http://localhost:8888",
  // Add any custom domains you’ll serve from:
  // "https://theorozcorealty.com",
];

// If true, allow "*" when the Origin isn't in ALLOW_ORIGINS (helpful during setup)
const FALLBACK_WILDCARD = true;

function buildCorsHeaders(origin, acrh) {
  const allowed = ALLOW_ORIGINS.includes(origin);
  const allowOrigin = allowed ? origin : (FALLBACK_WILDCARD ? "*" : ALLOW_ORIGINS[0]);

  const baseAllowed = ["Content-Type", "Authorization"];
  const requested = (acrh || "").split(",").map(h => h.trim()).filter(Boolean);
  const allowHeaders = Array.from(new Set([...baseAllowed, ...requested])).join(", ");

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

// ——— Handler ——————————————————————————————————————
module.exports.handler = async (event) => {
  const origin =
    event.headers?.origin ||
    event.headers?.Origin ||
    event.multiValueHeaders?.origin?.[0] ||
    "";

  const acrh =
    event.headers?.["access-control-request-headers"] ||
    event.headers?.["Access-Control-Request-Headers"] ||
    "";

  const headers = buildCorsHeaders(origin, acrh);

  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers, body: "" };
    }

    // Parse URL/search
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const forceDev = url.searchParams.get("forceDev") === "1";

    // Health/info
    if (event.httpMethod === "GET") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          note: "RE-Defined staging proxy: send POST with JSON to generate images.",
          expects: {
            method: "POST",
            json: {
              input_image_url: "https://…",
              room_type: "livingroom",
              design_style: "modern",
            },
          },
          env: { upstream: !!process.env.STAGE_API_URL },
          cors: { origin, allowed: ALLOW_ORIGINS.includes(origin) },
          tips: { forceDev }
        }),
      };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    // Parse JSON body
    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    // Upstream config
    const upstream = process.env.STAGE_API_URL && !forceDev ? process.env.STAGE_API_URL : "";
    const apiKey =
      process.env.DECOR8_API_KEY ||
      process.env.STAGE_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "";

    // Call upstream if configured
    if (upstream) {
      const upHeaders = { "Content-Type": "application/json" };
      if (apiKey) upHeaders.Authorization = `Bearer ${apiKey}`;

      const resp = await fetch(upstream, {
        method: "POST",
        headers: upHeaders,
        body: JSON.stringify(payload),
      });

      const text = await resp.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (!resp.ok) {
        return {
          statusCode: resp.status || 502,
          headers,
          body: JSON.stringify({
            error: "Upstream error",
            status: resp.status,
            detail: data,
          }),
        };
      }

      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // —— Dev fallback (no upstream OR forceDev=1) ——
    const original = payload.input_image_url || "";
    const demo =
      original ||
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1600&q=80";

    const out = {
      info: { images: [{ url: demo, width: 1600, height: 1067 }] },
      echo: { received: payload },
      note:
        "Dev fallback: set STAGE_API_URL and key env vars in Netlify to call the real staging backend.",
    };

    return { statusCode: 200, headers, body: JSON.stringify(out) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server exception", detail: String(err?.message || err) }),
    };
  }
};
