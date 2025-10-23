// netlify/functions/stage.js
// Minimal DECOR8 proxy with strict CORS on EVERY response.

const CORS = {
  "Access-Control-Allow-Origin": "*",                 // allow Webflow
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const JSON_CT = { "Content-Type": "application/json" };

const env = (k) => process.env[k];

export const handler = async (event) => {
  try {
    // --- CORS preflight ---
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS, body: "" };
    }

    // --- Simple GET help (with CORS) ---
    if (event.httpMethod === "GET") {
      return {
        statusCode: 200,
        headers: { ...CORS, ...JSON_CT },
        body: JSON.stringify({
          ok: true,
          note: "RE-Defined proxy: POST JSON to generate images.",
          expects: { json: { input_image_url: "https://…", room_type: "livingroom", design_style: "modern" } },
          env: { upstream: !!env("STAGE_API_URL"), hasKey: !!env("DECOR8_API_KEY") },
        }),
      };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { ...CORS, ...JSON_CT },
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    // --- Parse client payload ---
    const ct = event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!ct.toLowerCase().includes("application/json")) {
      return { statusCode: 400, headers: { ...CORS, ...JSON_CT }, body: JSON.stringify({ error: "Content-Type must be application/json" }) };
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

    const { input_image_url, room_type = "livingroom", design_style = "modern" } = body || {};
    if (!input_image_url) {
      return { statusCode: 400, headers: { ...CORS, ...JSON_CT }, body: JSON.stringify({ error: "Missing input_image_url" }) };
    }

    const upstream = env("STAGE_API_URL");          // e.g. https://api.decor8.ai/generate_designs_for_room
    const apiKey   = env("DECOR8_API_KEY");

    if (!upstream || !apiKey) {
      return {
        statusCode: 500,
        headers: { ...CORS, ...JSON_CT },
        body: JSON.stringify({ error: "Server not configured", detail: { upstream: !!upstream, hasKey: !!apiKey } }),
      };
    }

    // --- Build DECOR8 payload ---
    const payload = {
      input_image_url,            // DECOR8 accepts a public URL OR (depending on API) a base64 field; start with URL
      room_type,
      design_style,
    };

    // --- Call DECOR8 ---
    let resp;
    try {
      resp = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { statusCode: 502, headers: { ...CORS, ...JSON_CT }, body: JSON.stringify({ error: "Network to upstream failed", detail: String(e) }) };
    }

    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers: { ...CORS, ...JSON_CT },
        body: JSON.stringify({ error: "Upstream error", status: resp.status, detail: data }),
      };
    }

    // Normalize images array (DECOR8 variants)
    const images = data?.images || data?.result?.images || data?.output?.images || data?.data?.images || data?.info?.images || [];
    if (!images.length) {
      return { statusCode: 502, headers: { ...CORS, ...JSON_CT }, body: JSON.stringify({ error: "No images returned by upstream", detail: data }) };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, ...JSON_CT },
      body: JSON.stringify({ ok: true, info: { upstream: true, images } }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { ...CORS, ...JSON_CT }, body: JSON.stringify({ error: "Server exception", detail: String(err?.message || err) }) };
  }
};
