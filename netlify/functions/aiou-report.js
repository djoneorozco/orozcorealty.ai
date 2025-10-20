// A.I.O.U → Executive Buyer Memo (5 paragraphs) — CORS-hardened
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ---------------- CORS helpers ---------------- */
const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",               // allow Webflow origin
  "Access-Control-Allow-Headers": "*",              // accept any header
  "Access-Control-Allow-Methods": "POST, OPTIONS",  // preflight & POST
  "Access-Control-Max-Age": "86400",                // cache preflight
  "Vary": "Origin",
};
const ok = (bodyObj) => ({ statusCode: 200, headers: corsHeaders, body: JSON.stringify(bodyObj) });
const bad = (code, message) => ({ statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: message }) });

/* ---------------- tiny utils ---------------- */
const lastNameOf = (full) => String(full || "").trim().split(/\s+/).slice(-1)[0] || "Client";
const toCurrency = (n, d = 0) => (Number(n) || 0).toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d
});
const housingLane = (incomeMonthly) => ({ laneMin: incomeMonthly * 0.28, laneMax: incomeMonthly * 0.33 });

// ensure exactly 5 <p> blocks without dependencies
function enforceFiveParagraphsFromText(text, fallbackBlocks) {
  let parts = String(text || "").split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 5) parts = fallbackBlocks.slice(0, 5);
  while (parts.length < 5) parts.push("");
  if (parts.length > 5) parts = parts.slice(0, 5);
  return parts.map(p => `<p>${p.replace(/</g, "&lt;")}</p>`).join("");
}

/* ---------------- entry ---------------- */
exports.handler = async (event) => {
  // Always answer preflight with CORS headers
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  if (event.httpMethod !== "POST") return bad(405, "Use POST");

  if (!OPENAI_API_KEY) return bad(500, "OPENAI_API_KEY not configured");

  let brief = {};
  try { brief = JSON.parse(event.body || "{}"); }
  catch { return bad(400, "Invalid JSON"); }

  const { profile = {}, scores = {}, archetype = "", psych = {} } = brief;
  const first = String(profile.firstName || "").trim() || "Client";
  const last  = lastNameOf(`${profile.firstName || ""} ${profile.lastName || ""}`);
  const budgetMax = Number(profile.budgetMax || 0);
  const bedrooms  = Number(profile.bedrooms || 0);
  const setting   = String(profile.setting || "city");
  const safetyPriority = Number(profile.safetyPriority || 3);

  // Heuristic monthly income if not provided
  const assumedIncomeMonthly = Math.max(3500, Math.min(12000, budgetMax / 60));
  const lane = housingLane(assumedIncomeMonthly);

  // Local fallback memo (5 blocks)
  const localBlocks = [
    `<strong>${last}</strong>, this memo turns your A.I.O.U profile into a plan. Archetype: <strong>${archetype || "Balanced Explorer"}</strong>. We’ll match homes to how you live and avoid regret buys.`,
    `Targets: keep housing near <strong>28–33%</strong> of income. With ~${toCurrency(assumedIncomeMonthly,0)}/mo income, aim for <strong>${toCurrency(lane.laneMin,0)}–${toCurrency(lane.laneMax,0)}</strong> all-in (PITI/HOA/PMI). Shop <strong>under</strong> your max price to leave room for inspection and upgrades.`,
    `Key risks: stretching budget for style, thin reserves, and surprise repair costs. We size payment first, then pick homes that fit your style and hosting needs.`,
    `Playbook: focus on <strong>5–10 year-old</strong> homes or quality renovations (clean inspection; recent roof/HVAC/water heater). Prefer open kitchen/living or outdoor space over an extra unused bedroom. Lock your <strong>top 3 must-haves</strong> (safety, location, design) before touring.`,
    `Next steps: pre-underwrite in the lane above, preview homes that hit your must-haves, and use seller credits/points to balance cash vs rate. CFPB: https://www.consumerfinance.gov/  • Free credit reports: https://www.annualcreditreport.com/`,
  ];

  const systemPrompt = `
You are "Elena", an Executive Real Estate Strategist. Write EXACTLY 5 short paragraphs, plain English, no headings.
P1: Greet with last name + purpose; mention archetype in one sentence.
P2: Dollar targets: housing lane 28–33% using monthly income estimate; show min–max in USD; advise shopping below max price.
P3: 2–3 biggest risks/blind spots tuned to scores.
P4: Action playbook: 5–10 year-old or quality renovation, inspection strategy, open-plan/hosting vs extra bedroom, define top 3 must-haves. Include 1–2 credible links (CFPB, AnnualCreditReport).
P5: Closing + next steps.
Style: crisp, friendly, no jargon, whole dollars only.
`;

  const userPrompt = `
INPUT:
${JSON.stringify({
  profile: { first, last, bedrooms, budgetMax, setting, safetyPriority },
  scores, archetype, psych,
  computed: {
    assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
    housingLaneMin: Math.round(lane.laneMin),
    housingLaneMax: Math.round(lane.laneMax),
    guidance: { preferSetting: setting, suggestAgeWindow: "5–10 years or quality renovation" }
  }
}, null, 2)}
Write the five paragraphs now.`;

  async function callOpenAI() {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      }),
    });
    if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  }

  try {
    const memoText = await callOpenAI();
    const memoHtml = enforceFiveParagraphsFromText(memoText, localBlocks);
    return ok({
      ok: true,
      memo: memoText,
      memoHtml,
      meta: {
        archetype, scores,
        assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
        lane: { minMonthly: Math.round(lane.laneMin), maxMonthly: Math.round(lane.laneMax) }
      }
    });
  } catch (e) {
    const memoHtml = enforceFiveParagraphsFromText("", localBlocks);
    return ok({
      ok: false,
      error: String(e.message || e),
      memo: localBlocks.join("\n\n"),
      memoHtml,
      meta: {
        fallback: true, archetype, scores,
        assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
        lane: { minMonthly: Math.round(lane.laneMin), maxMonthly: Math.round(lane.laneMax) }
      }
    });
  }
};
