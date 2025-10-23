// netlify/functions/stage.js
import { getStore } from "@netlify/blobs";

const ALLOW_ORIGINS = [
  "https://new-real-estate-purchase.webflow.io",
  "https://theorozcorealty.netlify.app",
  "http://localhost:8888",
];

const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOW_ORIGINS.includes(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const env = (k) => process.env[k];
const parseJSON = (t) => { try { return JSON.parse(t); } catch { return null; } };

async function toPublicUrlIfDataUrl(inputUrl){
  if (!inputUrl || !String(inputUrl).startsWith("data:")) return { url: inputUrl, notes: [] };
  const notes = [];
  try {
    const m = /^data:(.+?);base64,(.*)$/i.exec(inputUrl);
    if (!m) return { url: inputUrl, notes: ["dataURL-parse-failed"] };
    const mime = m[1];
    const b64  = m[2];
    const buf  = Buffer.from(b64, "base64");

    const store = getStore({ name: "redefined-inputs", consistency: "strong" });
    const ext = (mime.split("/")[1] || "bin").split("+")[0];
    const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    await store.set(key, buf, { contentType: mime, metadata: { source: "webflow" } });
    const publicUrl = await store.getPublicUrl(key);
    notes.push("blobs-upload-ok");
    return { url: publicUrl, notes };
  } catch (e) {
    // Don’t crash — return original data URL and tell the client what happened
    notes.push("blobs-upload-failed:" + String(e?.message || e));
    return { url: inputUrl, notes };
  }
}

function devImageResponse(original, notes=[]) {
  const demo = "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?q=80&w=1600&auto=format&fit=crop";
  return {
    ok: true,
    info: {
      upstream: false,
      images: [{ url: demo, width: 1600, height: 1067 }],
      echo: { input_image_url: original },
      notes,
    },
  };
}

export const handler = async (event) => {
  const origin  = event.headers?.origin || event.headers?.Origin || "";
  const headers = cors(origin);

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        note: "RE-Defined proxy: POST JSON to generate images.",
        expects: { json: { input_image_url: "https://…", room_type: "livingroom", design_style: "modern" } },
        env: {
          upstream: !!env("STAGE_API_URL"),
          hasKey: !!(env("DECOR8_API_KEY") || env("STAGE_API_KEY") || env("OPENAI_API_KEY")),
        },
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const qs = new URLSearchParams(event.rawQuery || "");
    const forceDev = qs.get("forceDev")==="1" || String(env("STAGE_FORCE_DEV")).toLowerCase()==="true";

    const ct = event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!ct.toLowerCase().includes("application/json")) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Content-Type must be application/json" }) };
    }

    const body = parseJSON(event.body || "{}") || {};
    let {
      input_image_url,
      room_type,
      design_style,
      num_images,
      scale_factor,
      color_scheme,
      speciality_decor,
      prompt,
      prompt_prefix,
    } = body;

    if (!input_image_url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing input_image_url" }) };
    }

    // Make sure upstream gets a fetchable URL
    const { url: preparedUrl, notes } = await toPublicUrlIfDataUrl(input_image_url);

    if (forceDev || !env("STAGE_API_URL")) {
      return { statusCode: 200, headers, body: JSON.stringify(devImageResponse(preparedUrl, notes)) };
    }

    // Upstream call (DECOR8)
    const upstream = env("STAGE_API_URL");
    const apiKey   = env("DECOR8_API_KEY") || env("STAGE_API_KEY") || env("OPENAI_API_KEY") || "";

    const payload = {
      input_image_url: preparedUrl,   // keep both names to satisfy various schemas
      image_url:       preparedUrl,
      room_type, design_style,
      num_images:  Number(num_images || 1),
      scale_factor: Number(scale_factor || 2),
      color_scheme, speciality_decor, prompt, prompt_prefix,
    };

    let r;
    try {
      r = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: "Network to upstream failed",
          detail: String(netErr?.message || netErr),
          notes,
        }),
      };
    }

    const text = await r.text();
    const j = parseJSON(text) || { raw: text };

    if (!r.ok) {
      return {
        statusCode: r.status,
        headers,
        body: JSON.stringify({
          error: "Upstream error",
          status: r.status,
          detail: j,
          notes,
          sent: { ...payload, input_image_url: `${preparedUrl.slice(0,60)}…` },
        }),
      };
    }

    const images =
      j.images ||
      j.output?.images ||
      j.result?.images ||
      j.data?.images ||
      j?.info?.images ||
      [];

    if (!images.length) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "No images returned by upstream", detail: j, notes }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        info: { upstream: true, images, echo: { input_image_url: preparedUrl }, notes },
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server exception", detail: String(err?.message || err) }) };
  }
};
