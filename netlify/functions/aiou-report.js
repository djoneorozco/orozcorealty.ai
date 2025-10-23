// netlify/functions/ask-elena.js
// CommonJS + Node 18 native fetch

/* =========================================================
  //#1 CONFIG & CONSTANTS
  - CORS allowlist
  - Model + timeouts are env-overridable
  - Optional persona JSON loader (see //#4)
========================================================= */
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const ALLOW_ORIGINS = [
  "https://new-real-estate-purchase.webflow.io",
  "https://theorozcorealty.netlify.app",
  "http://localhost:8888", // netlify dev
];

const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

const MODEL = process.env.ASK_ELENA_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.ASK_ELENA_TEMP || 0.4);
const MAX_TOKENS = Number(process.env.ASK_ELENA_MAXTOK || 500);
const REQUEST_TIMEOUT_MS = Number(process.env.ASK_ELENA_TIMEOUT_MS || 30000);
const PERSONA_PATH =
  process.env.PERSONA_JSON_PATH ||
  path.join(process.cwd(), "persona", "ask-elena-persona.json"); // optional, not required

/* =========================================================
  //#2 CORS HELPERS
========================================================= */
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

/* =========================================================
  //#3 UTILITIES
========================================================= */
function safeJsonParse(str, fallback = {}) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function withTimeout(promise, ms, onTimeoutMessage = "Upstream timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(onTimeoutMessage)), ms)
    ),
  ]);
}

function pickAddress(lead = {}) {
  // lead: { firstName, lastName, rank, preferMilitaryAddress, suppressRank }
  const first = (lead.firstName || "").trim();
  const last = (lead.lastName || "").trim();
  const rank = (lead.rank || "").trim();

  if (lead.suppressRank) return first || "there";

  const wantMilitary =
    lead.preferMilitaryAddress ||
    (!!rank && !!last); // auto if both provided

  if (wantMilitary && rank && last) return `${rank} ${last}`;
  return first || "there";
}

function buildContextHints(lead = {}) {
  // Small hints that shape responses without leaking private details
  const parts = [];

  // Financial Health Grade (if you pass it from your dashboard)
  if (lead.financialHealthGrade) {
    parts.push(
      `User financial-health grade: ${String(lead.financialHealthGrade)}.`
    );
  }

  // Buyer/Seller/Investor intent (optional)
  if (lead.intent) {
    parts.push(`User intent: ${String(lead.intent)}.`);
  }

  // Military knobs
  if (lead.rank || lead.yearsInService || lead.dependents || lead.zip) {
    parts.push(
      "Profile includes military context (Rank/Years/Dependents/ZIP). Be BAH/BAS aware."
    );
  }

  return parts.join(" ");
}

/* =========================================================
  //#4 OPTIONAL PERSONA LOAD (non-fatal if missing)
  - If present, folds high-level guardrails into system prompt
========================================================= */
function loadPersonaJSON() {
  try {
    if (fs.existsSync(PERSONA_PATH)) {
      const raw = fs.readFileSync(PERSONA_PATH, "utf-8");
      return safeJsonParse(raw, null);
    }
  } catch {
    // ignore; fall back to lightweight system prompt
  }
  return null;
}

/* =========================================================
  //#5 SYSTEM PROMPT BUILDER
  - Professional, elegant, subtly playful; zero celebrity voice claims
  - 4–8 sentence guidance + ask for next helpful action
========================================================= */
function buildSystemPrompt(persona, addressLabel, contextHints) {
  // Base persona (used whether or not JSON is available)
  const base = [
    "You are Elena — a luxury-polished, warm, and confident real-estate advisor.",
    "Specialties: VA-aware affordability strategy (BAH/BAS), comps & pricing logic, investor ROI for flips/BRRRR, and calm, accurate Q&A.",
    "Tone: elegant, reassuring, emotionally intelligent; subtly playful but always professional.",
    "Style: concise, concrete, and human. Prefer clear steps, brief lists when helpful, and plain-English explanations.",
    "Safety: avoid explicit sexual content, medical/legal advice, or overpromising. If data may be stale, say so and offer to refresh.",
    "Output length: 4–8 sentences by default. Include a practical next step and a soft closing question to continue the conversation.",
  ].join(" ");

  // If persona JSON is present, fold key pillars and addressing rules
  let extras = "";
  if (persona) {
    const pillars = persona?.style_guidelines?.pillars || [];
    const dtiWarn =
      persona?.domains?.real_estate?.financial_dashboard?.knobs
        ?.dti_threshold_warn;
    const savingsTarget =
      persona?.domains?.real_estate?.financial_dashboard?.knobs
        ?.savings_target;

    if (pillars.length) {
      extras += ` Core pillars: ${pillars.join(", ")}.`;
    }
    if (typeof dtiWarn === "number") {
      extras += ` Treat DTI >= ${dtiWarn} as elevated risk; explain calmly and offer options.`;
    }
    if (typeof savingsTarget === "number") {
      extras += ` Savings rate target reference ~ ${Math.round(
        savingsTarget * 100
      )}%.`;
    }
  }

  const address = addressLabel
    ? `When greeting, use: "${addressLabel}" (unless the user corrects you).`
    : "Greet naturally.";

  return [
    base,
    address,
    contextHints ? `Context hints: ${contextHints}` : "",
    extras,
  ]
    .filter(Boolean)
    .join(" ");
}

/* =========================================================
  //#6 MAIN HANDLER
========================================================= */
module.exports.handler = async (event) => {
  const reqId = randomUUID();
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // OPTIONS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
    }
  // Only POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: "Method Not Allowed",
        requestId: reqId,
      }),
    };
  }

  // Parse body
  const payload = safeJsonParse(event.body || "{}");
  const userText = (payload.message || "").toString().trim();
  const lead = payload.lead || {};

  if (!userText) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing message", requestId: reqId }),
    };
  }

  // Friendly echo if no key configured
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const address = pickAddress(lead);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply: `Elena (dev echo to ${address}): “${userText}”. Add OPENAI_API_KEY to enable real answers.`,
        lead,
        requestId: reqId,
      }),
    };
  }

  // Persona & addressing
  const personaJSON = loadPersonaJSON(); // optional
  const addressLabel = pickAddress(lead);
  const contextHints = buildContextHints(lead);
  const system = buildSystemPrompt(personaJSON, addressLabel, contextHints);

  const messages = [
    { role: "system", content: system },
    // Greeting nudge (soft, not user-visible instruction)
    {
      role: "system",
      content: `If appropriate, start with "Hey ${addressLabel} —" or a brief professional greeting.`,
    },
    { role: "user", content: userText },
  ];

  // OpenAI Call
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const resp = await withTimeout(
      fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
          messages,
        }),
        signal: controller.signal,
      }),
      REQUEST_TIMEOUT_MS,
      "OpenAI request timed out"
    );
    clearTimeout(timer);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: "OpenAI upstream error",
          detail,
          requestId: reqId,
        }),
      };
    }

    const data = await resp.json();
    const reply =
      (data?.choices?.[0]?.message?.content || "").trim() ||
      "I’m here. What would you like to explore next?";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply,
        meta: {
          model: MODEL,
          temperature: TEMPERATURE,
          requestId: reqId,
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Server exception",
        detail: String(err?.message || err),
        requestId: reqId,
      }),
    };
  }
};
