// netlify/functions/stage.js
// ESM (matches package.json "type": "module") — Node 18+ with native fetch

// //#1 CORS ORIGINS
const ALLOW_ORIGINS = [
  "https://new-real-estate-purchase.webflow.io",
  "https://theorozcorealty.netlify.app",
  "http://localhost:8888",
  // "https://theorozcorealty.com", // add when live
];

// If true, allow "*" when Origin isn't in ALLOW_ORIGINS (useful during setup)
const FALLBACK_WILDCARD = true;

function buildCorsHeaders(origin, acrh) {
  const allowStar = FALLBACK_WILDCARD && (!origin || !ALLOW_ORIGINS.includes(origin));
  const allowOrigin = allowStar ? "*" : origin || "*";
  const base = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": acrh || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  // If we’re not echoing the incoming ACRH, still permit common headers.
  if (!acrh) base["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept";
  return base;
}

// //#2 Helpers
const parseJSON = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};
const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k]]));
const env = (k) => process.env[k];

// //#3 Dev placeholder (always returns a single enhanced image)
function devImageResponse(original) {
  // A static, safe image (unsplash) that reliably loads for demo/testing
  const demo = "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?q=80&w=1600&auto=format&fit=crop";
  return {
    ok: true,
    info: {
      env: { upstream: false, dev: true },
      images: [
        { url: demo, width: 1600, height: 1067, note: "Dev demo image" }
      ],
      echo: { input_image_url: original }
    }
  };
}

// //#4 Handler
export const handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const acrh = event.headers?.["access-control-request-headers"];
  const headers = buildCorsHeaders(origin, acrh);

  // Health / info
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        note: "RE-Defined staging proxy: send POST with JSON to generate images.",
        expects: {
          method: "POST",
          json: { input_image_url: "https://…", room_type: "livingroom", design_style: "modern" }
        },
        env: { upstream: !!env("STAGE_API_URL") },
        cors: { origin, allowed: ALLOW_ORIGINS.includes(origin) },
        tips: { forceDev: !!env("STAGE_FORCE_DEV") }
      })
    };
  }

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  // Only POST beyond this point
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const qs = new URLSearchParams(event.rawQuery || "");
    const forceDev = qs.get("forceDev") === "1" || String(env("STAGE_FORCE_DEV")).toLowerCase() === "true";

    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Content-Type must be application/json" }) };
    }

    const bodyObj = parseJSON(event.body || "{}") || {};
    const { input_image_url, room_type, design_style } = bodyObj;

    if (!input_image_url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing input_image_url" }) };
    }

    // Dev fallback (guaranteed success to unblock UI)
    if (forceDev || !env("STAGE_API_URL")) {
      const out = devImageResponse(input_image_url);
      return { statusCode: 200, headers, body: JSON.stringify(out) };
    }

    // Upstream proxy
    const upstream = env("STAGE_API_URL");
    const apiKey = env("DECOR8_API_KEY") || env("STAGE_API_KEY") || env("OPENAI_API_KEY") || "";
    const reqPayload = { input_image_url, room_type, design_style };

    const r = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(reqPayload),
    });

    const text = await r.text();
    const j = parseJSON(text) || { raw: text };

    if (!r.ok) {
      // Bubble details for easier client-side debugging
      return {
        statusCode: r.status,
        headers,
        body: JSON.stringify({
          error: "Upstream error",
          status: r.status,
          detail: pick(j, ["error", "message", "detail"]) ?? j
        })
      };
    }

    // Normalize to { info: { images: [...] } }
    const images = j.images || j.output?.images || j.data?.images || [];
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        info: {
          upstream: true,
          images,
          echo: { input_image_url, room_type, design_style }
        }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server exception", detail: String(err?.message || err) })
    };
  }
};
