// netlify/functions/stage.js
// Node 18+, ESM
import { getStore } from "@netlify/blobs";

const ALLOW_ORIGINS = [
  "https://new-real-estate-purchase.webflow.io",
  "https://theorozcorealty.netlify.app",
  "http://localhost:8888"
];

const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOW_ORIGINS.includes(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

const env = (k) => process.env[k];
const parseJSON = (t) => { try { return JSON.parse(t); } catch { return null; } };

function devImageResponse(original) {
  const demo = "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?q=80&w=1600&auto=format&fit=crop";
  return {
    ok: true,
    info: { upstream:false, images:[{ url: demo, width:1600, height:1067 }], echo:{ input_image_url: original } }
  };
}

// Turn data: URL into a public Netlify Blob and return its public URL
async function toPublicUrlIfDataUrl(inputUrl) {
  if (!inputUrl || !String(inputUrl).startsWith("data:")) return inputUrl;
  const m = /^data:(.+?);base64,(.*)$/i.exec(inputUrl);
  if (!m) return inputUrl;
  const mime = m[1]; const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  const store = getStore({ name: "redefined-inputs", consistency: "strong" });
  const ext = (mime.split("/")[1] || "bin").split("+")[0];
  const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await store.set(key, buf, { contentType: mime, metadata:{ source:"webflow" } });
  return await store.getPublicUrl(key);
}

export const handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const headers = cors(origin);

  if (event.httpMethod === "OPTIONS") return { statusCode:204, headers };
  if (event.httpMethod === "GET") {
    return {
      statusCode:200, headers,
      body: JSON.stringify({
        ok:true,
        note:"RE-Defined proxy: POST JSON to generate images.",
        expects:{ json:{ input_image_url:"https://…", room_type:"livingroom", design_style:"modern" }},
        env:{ upstream: !!env("STAGE_API_URL"), hasKey: !!(env("DECOR8_API_KEY")||env("STAGE_API_KEY")||env("OPENAI_API_KEY")) }
      })
    };
  }
  if (event.httpMethod !== "POST") return { statusCode:405, headers, body: JSON.stringify({ error:"Method not allowed" }) };

  try {
    const qs = new URLSearchParams(event.rawQuery || "");
    const forceDev = qs.get("forceDev")==="1" || String(env("STAGE_FORCE_DEV")).toLowerCase()==="true";

    const ct = event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!ct.toLowerCase().includes("application/json")) {
      return { statusCode:400, headers, body: JSON.stringify({ error:"Content-Type must be application/json" }) };
    }

    const body = parseJSON(event.body || "{}") || {};
    let {
      input_image_url, room_type, design_style, num_images, scale_factor,
      color_scheme, speciality_decor, prompt, prompt_prefix
    } = body;

    if (!input_image_url) return { statusCode:400, headers, body: JSON.stringify({ error:"Missing input_image_url" }) };

    // Always provide a fetchable URL to upstream
    const publicUrl = await toPublicUrlIfDataUrl(input_image_url);

    if (forceDev || !env("STAGE_API_URL")) {
      return { statusCode:200, headers, body: JSON.stringify(devImageResponse(publicUrl)) };
    }

    const upstream = env("STAGE_API_URL");
    const apiKey = env("DECOR8_API_KEY") || env("STAGE_API_KEY") || env("OPENAI_API_KEY") || "";

    // Be generous with field names — some APIs expect image_url instead of input_image_url
    const payload = {
      input_image_url: publicUrl,
      image_url: publicUrl,
      room_type,
      design_style,
      num_images: Number(num_images || 1),
      scale_factor: Number(scale_factor || 2),
      color_scheme,
      speciality_decor,
      prompt,
      prompt_prefix
    };

    const r = await fetch(upstream, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    const j = parseJSON(text) || { raw:text };

    if (!r.ok) {
      // Return detailed info so you can see it in the browser console
      return {
        statusCode: r.status,
        headers,
        body: JSON.stringify({
          error: "Upstream error",
          status: r.status,
          sent: { ...payload, input_image_url: publicUrl.slice(0,60)+"…" },
          detail: j
        })
      };
    }

    // normalize possible shapes
    const from =
      j.images ||
      j.output?.images ||
      j.result?.images ||
      j.data?.images ||
      j?.info?.images ||
      [];
    if (!from.length) {
      return { statusCode:502, headers, body: JSON.stringify({ error:"No images returned by upstream", detail:j }) };
    }

    return { statusCode:200, headers, body: JSON.stringify({ ok:true, info:{ upstream:true, images: from, echo:{ input_image_url: publicUrl } } }) };
  } catch (err) {
    return { statusCode:500, headers, body: JSON.stringify({ error:"Server exception", detail: String(err?.message || err) }) };
  }
};
