// netlify/functions/ask-elena.js
// CommonJS + Node 18 native fetch

/* =========================================================
  //#1 CONFIG & CONSTANTS
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

const MODEL_DEFAULT = process.env.ASK_ELENA_MODEL || "gpt-4o-mini";
const TEMPERATURE_DEFAULT = Number(process.env.ASK_ELENA_TEMP || 0.45);
const MAX_TOKENS_DEFAULT = Number(process.env.ASK_ELENA_MAXTOK || 750);
const REQUEST_TIMEOUT_MS = Number(process.env.ASK_ELENA_TIMEOUT_MS || 30000);
const PERSONA_PATH =
  process.env.PERSONA_JSON_PATH ||
  path.join(process.cwd(), "persona", "ask-elena-persona.json");

// Guards
const MAX_MESSAGE_CHARS = Number(process.env.ASK_ELENA_MAX_MSG_CHARS || 6000);
const MAX_HISTORY_ITEMS = Number(process.env.ASK_ELENA_MAX_HISTORY || 6);

/* =========================================================
  //#2 MODULE-LEVEL CACHE (warm invocations reuse)
========================================================= */
let PERSONA_CACHE = null;
function getPersonaCached() {
  if (PERSONA_CACHE !== null) return PERSONA_CACHE;
  try {
    if (fs.existsSync(PERSONA_PATH)) {
      const raw = fs.readFileSync(PERSONA_PATH, "utf-8");
      PERSONA_CACHE = JSON.parse(raw);
      return PERSONA_CACHE;
    }
  } catch (_) {}
  PERSONA_CACHE = null;
  return PERSONA_CACHE;
}

/* =========================================================
  //#3 CORS & UTILS
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
  const first = (lead.firstName || "").trim();
  const last = (lead.lastName || "").trim();
  const rank = (lead.rank || "").trim();
  if (lead.suppressRank) return first || "there";
  const wantMilitary = lead.preferMilitaryAddress || (!!rank && !!last);
  if (wantMilitary && rank && last) return `${rank} ${last}`;
  return first || "there";
}

function trimHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(h => h && typeof h.content === "string" && h.role)
    .slice(-MAX_HISTORY_ITEMS);
}

function buildContextHints(lead = {}, context = {}) {
  const parts = [];
  if (lead.financialHealthGrade)
    parts.push(`Financial-health grade: ${String(lead.financialHealthGrade)}.`);
  if (lead.intent) parts.push(`User intent: ${String(lead.intent)}.`);
  if (lead.rank || lead.yearsInService || lead.dependents || lead.zip)
    parts.push("Military profile present (Rank/Years/Dependents/ZIP). Use BAH/BAS awareness.");
  if (typeof context.dti === "number")
    parts.push(`DTI ≈ ${Math.round(context.dti * 100)}%.`);
  if (typeof context.savingsRate === "number")
    parts.push(`Savings rate ≈ ${Math.round(context.savingsRate * 100)}%.`);
  if (typeof context.housingRatio === "number")
    parts.push(`Housing ratio ≈ ${Math.round(context.housingRatio * 100)}%.`);
  return parts.join(" ");
}

/* =========================================================
  //#4 LIGHT INTENT HINTS (steer tone & quick replies)
========================================================= */
function detectIntent(userText = "") {
  const t = userText.toLowerCase();
  if (/(^|\s)va( |\-)?loan|certificate of eligibility|coe/.test(t))
    return "va_loan";
  if (/pre[- ]?approve|preapproval|pre-approval/.test(t))
    return "preapproval";
  if (/home ?buy|where to start|getting started/.test(t))
    return "start_buying";
  if (/invest|flip|arv|70% rule|brrr/.test(t))
    return "investing";
  return "general";
}

function suggestedRepliesFor(intent) {
  switch (intent) {
    case "va_loan":
      return [
        "Check my COE requirements",
        "Estimate my VA price range",
        "Show VA funding fee basics",
      ];
    case "preapproval":
      return [
        "What docs do I need?",
        "How long does pre-approval take?",
        "Estimate max budget first",
      ];
    case "start_buying":
      return [
        "Set my budget with BAH/BAS",
        "Create a step-by-step plan",
        "What should I do this week?",
      ];
    case "investing":
      return [
        "Run a flip/BRRRR ROI check",
        "Explain ARV and comps",
        "What’s a safe margin today?",
      ];
    default:
      return ["Show me next 3 best steps", "Estimate my budget", "Talk to a lender?"];
  }
}

/* =========================================================
  //#5 SYSTEM PROMPT (emotion-first, anti-generic)
========================================================= */
function buildSystemPrompt(persona, addressLabel, contextHints, mode = "normal") {
  const base = [
    "You are Elena — a luxury-polished, warm, and confident real-estate advisor.",
    "Start with a brief, human, emotionally-intelligent bridge (acknowledge the user's situation) before giving steps.",
    "Tone: elegant, reassuring, subtly playful; never robotic. Avoid bland boilerplate like 'Here are some steps' or 'It can be overwhelming' unless rewritten with personality.",
    "Style: concrete, specific, and useful. Prefer crisp sentences, compact bullets when needed, and plain-English rationale.",
    "Safety: no explicit sexual content; no legal/medical advice; if data may be stale, say so and offer to refresh.",
    "Default length: 4–8 sentences. End with one practical next move + a soft question to continue.",
    "Banned phrasing: 'There! Absolutely, I'd be happy to', 'Here is a simple guide', 'Next, follow these steps' — rewrite into warm, natural, and premium language.",
  ].join(" ");

  let extras = "";
  if (persona) {
    const pillars = persona?.style_guidelines?.pillars || [];
    const dtiWarn = persona?.domains?.real_estate?.financial_dashboard?.knobs?.dti_threshold_warn;
    const savingsTarget = persona?.domains?.real_estate?.financial_dashboard?.knobs?.savings_target;
    if (pillars.length) extras += ` Core pillars: ${pillars.join(", ")}.`;
    if (typeof dtiWarn === "number") extras += ` Treat DTI >= ${dtiWarn} as elevated risk; frame options calmly and constructively.`;
    if (typeof savingsTarget === "number") extras += ` Savings-rate reference ~ ${Math.round(savingsTarget * 100)}%.`;
  }

  const address = addressLabel
    ? `When greeting, prefer: "${addressLabel}" unless the user corrects you.`
    : "Greet naturally.";

  const lengthHint =
    mode === "short"
      ? "Keep to ~4 sentences."
      : mode === "deep"
      ? "Allow 8–12 sentences; include one compact bullet list."
      : "";

  return [base, address, contextHints ? `Context hints: ${contextHints}` : "", lengthHint, extras]
    .filter(Boolean)
    .join(" ");
}

/* =========================================================
  //#6 OPENAI CALL WITH RETRY/BACKOFF
========================================================= */
async function openAIChat({ key, messages, model, temperature, max_tokens, timeoutMs }) {
  let attempt = 0;
  const maxAttempts = 3;
  let lastDetail = "";

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await withTimeout(
        fetch(OPENAI_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model, temperature, max_tokens, messages }),
          signal: controller.signal,
        }),
        timeoutMs,
        "OpenAI request timed out"
      );
      clearTimeout(timer);

      if (resp.ok) {
        const data = await resp.json();
        return { ok: true, data, status: resp.status };
      }

      lastDetail = await resp.text().catch(() => "");
      if (resp.status === 429 || (resp.status >= 500 && resp.status <= 599)) {
        const backoff = 250 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      return { ok: false, status: resp.status, detail: lastDetail || "Upstream error" };
    } catch (err) {
      lastDetail = String(err?.message || err);
      const backoff = 250 * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  return { ok: false, status: 502, detail: lastDetail || "OpenAI upstream unreachable after retries" };
}

/* =========================================================
  //#7 MAIN HANDLER
========================================================= */
module.exports.handler = async (event) => {
  const reqId = randomUUID();
  const t0 = Date.now();
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  // Only POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed", requestId: reqId }),
    };
  }

  // Parse
  const payload = safeJsonParse(event.body || "{}");
  const userText = (payload.message || "").toString();
  const lead = payload.lead || {};
  const context = payload.context || {};
  const history = trimHistory(payload.history);
  const mode = (payload.mode || "normal").toLowerCase();
  const modelOverride = (payload.model || "").trim();

  if (!userText.trim()) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing message", requestId: reqId }),
    };
  }
  if (userText.length > MAX_MESSAGE_CHARS) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: `Message too long (>${MAX_MESSAGE_CHARS} chars).`,
        requestId: reqId,
      }),
    };
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const address = pickAddress(lead);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply: `Elena (dev echo to ${address}): “${userText}”. Add OPENAI_API_KEY to enable real answers.`,
        lead,
        meta: { requestId: reqId, model: "echo" },
        quickReplies: suggestedRepliesFor(detectIntent(userText)),
      }),
    };
  }

  // Persona + prompts
  const persona = getPersonaCached(); // optional, cached
  const addressLabel = pickAddress(lead);
  const contextHints = buildContextHints(lead, context);
  const system = buildSystemPrompt(persona, addressLabel, contextHints, mode);

  // Intent hints to push emotion and specificity
  const intent = detectIntent(userText);
  const intentNudge =
    intent === "va_loan"
      ? "User is asking about VA loans. Use a reassuring, expert tone; mention COE, funding fee basics at a high level, and invite to estimate price range using Rank/ZIP if they wish."
      : intent === "start_buying"
      ? "User needs a calm, simple path to begin buying. Provide a short phased plan (this week, next two weeks) and offer a budget estimate."
      : intent === "preapproval"
      ? "User is curious about pre-approval. Explain purpose, typical docs, timeline, and invite them to check budget first if they prefer."
      : intent === "investing"
      ? "User is investor-minded. Briefly reference ARV/comps and margin of safety; offer to run a quick ROI snapshot."
      : "Keep it practical and tailored; avoid generic boilerplate.";

  const messages = [
    { role: "system", content: system },
    { role: "system", content: `When appropriate, greet "${addressLabel}" briefly and professionally.` },
    { role: "system", content: intentNudge },
    ...history,
    { role: "user", content: userText.trim() },
  ];

  // Params
  const model = modelOverride || MODEL_DEFAULT;
  const temperature = TEMPERATURE_DEFAULT;
  const max_tokens = MAX_TOKENS_DEFAULT;

  // Call OpenAI
  const result = await openAIChat({
    key,
    messages,
    model,
    temperature,
    max_tokens,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const elapsedMs = Date.now() - t0;

  if (!result.ok) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: "OpenAI upstream error",
        detail: result.detail || "",
        status: result.status,
        meta: { requestId: reqId, elapsedMs },
      }),
    };
  }

  const data = result.data || {};
  const reply =
    (data?.choices?.[0]?.message?.content || "").trim() ||
    "I’m here — what would you like to explore next?";

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      reply,
      lead,
      meta: {
        model,
        temperature,
        max_tokens,
        mode,
        requestId: reqId,
        elapsedMs,
        usedHistory: history.length,
        intent,
      },
      quickReplies: suggestedRepliesFor(intent),
    }),
  };
};
