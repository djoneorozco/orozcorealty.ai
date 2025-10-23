// A.I.O.U → Executive Buyer Memo (Military-aware, FH Grade–aware) — CORS-hardened
// Drop-in replacement for netlify/functions/aiou-report.js

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ---------------- CORS helpers ---------------- */
const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const ok  = (obj) => ({ statusCode: 200, headers: corsHeaders, body: JSON.stringify(obj) });
const bad = (code, msg) => ({ statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: msg }) });

/* ---------------- tiny utils ---------------- */
const lastNameOf = (full) => String(full || "").trim().split(/\s+/).slice(-1)[0] || "Client";
const toCurrency = (n, d = 0) =>
  (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });

function enforceFiveParagraphsFromText(text, fallbackBlocks) {
  let parts = String(text || "").split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 5) parts = fallbackBlocks.slice(0, 5);
  while (parts.length < 5) parts.push("");
  if (parts.length > 5) parts = parts.slice(0, 5);
  return parts.map(p => `<p>${p.replace(/</g, "&lt;")}</p>`).join("");
}

/* ---------------- income lane helpers ---------------- */
const laneFromMonthlyIncome = (incomeMonthly) => ({
  laneMin: incomeMonthly * 0.28,
  laneMax: incomeMonthly * 0.33,
});

/* ---------------- entry ---------------- */
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return bad(405, "Use POST");
  if (!OPENAI_API_KEY) return bad(500, "OPENAI_API_KEY not configured");

  let brief = {};
  try { brief = JSON.parse(event.body || "{}"); }
  catch { return bad(400, "Invalid JSON"); }

  // Incoming payload pieces we expect from the client UI
  const {
    profile = {},             // { firstName, lastName, bedrooms, budgetMax, setting, safetyPriority }
    scores = {},              // OCEAN averages
    archetype = "",
    psych = {},               // { totalItems, inconsistencies, ... }
    military = {},            // NEW: { rankTitle, rankPaygrade, yearsInService, monthlyBasePay }
    finance = {},             // NEW: { fhGrade: 'A'|'B'|'C'|'D'|'F', dti?, reservesMonths? ... }
    visual = {}               // OPTIONAL: { styleVsPriceSlider: -5..+5, etc. }
  } = brief;

  // Build the rank/name line
  const last  = lastNameOf(`${profile.firstName || ""} ${profile.lastName || ""}`);
  const rankTitle = String(military.rankTitle || military.rankPaygrade || "").trim();
  const rankName  = rankTitle ? `${rankTitle} ${last}` : last;

  // Monthly income (prefer exact from dashboard; otherwise estimate from budget)
  const monthlyBase = Number(military.monthlyBasePay || 0);
  const budgetMax   = Number(profile.budgetMax || 0);
  const assumedIncomeMonthly = monthlyBase > 0
    ? monthlyBase
    : Math.max(3500, Math.min(12000, budgetMax / 60)); // fallback heuristic

  const lane = laneFromMonthlyIncome(assumedIncomeMonthly);

  // Helpful flags derived from FH Grade
  const fhGrade = String(finance.fhGrade || "").toUpperCase(); // A..F
  const fhTight = ["D", "F"].includes(fhGrade);   // be more conservative
  const fhSolid = ["A", "B"].includes(fhGrade);   // more flexibility

  // Build a simple “buyer style” note from visuals (optional)
  const styleVsPrice = typeof visual.styleVsPriceSlider === "number" ? visual.styleVsPriceSlider : null; // -5..+5
  const stylePrefNote =
    styleVsPrice==null ? "No style-vs-price slider recorded."
    : styleVsPrice >= 3 ? "leans style-forward over lowest payment"
    : styleVsPrice <= -3 ? "leans price-first over style upgrades"
    : "balanced on style vs price";

  // Local fallback memo (5 blocks; military-aware greeting)
  const localBlocks = [
    `<strong>${rankName}</strong>, this memo turns your A.I.O.U profile into a plan. Archetype: <strong>${archetype || "Balanced Explorer"}</strong>. We’ll match homes to how you live and avoid regret buys.`,
    `Targets: keep housing near <strong>28–33%</strong> of monthly income. With ~${toCurrency(assumedIncomeMonthly,0)}/mo income, aim for <strong>${toCurrency(lane.laneMin,0)}–${toCurrency(lane.laneMax,0)}</strong> all-in (PITI/HOA/PMI). Shop below max price to leave room for inspection findings and upgrades.`,
    `Signals: ${stylePrefNote}. Financial Health Grade: ${fhGrade || "—"}. We’ll watch for budget creep, thin reserves, and scope drift on repairs.`,
    `Playbook: focus on <strong>5–10 year-old</strong> homes or quality renovations (clean inspection; recent roof/HVAC/water heater). Prefer open kitchen/hosting flow over unused square-footage. Lock your <strong>top 3 must-haves</strong> before touring.`,
    `Next steps: pre-underwrite in the lane above, preview inventory that matches your trade-offs, and use seller credits/points to balance cash vs rate. CFPB: https://www.consumerfinance.gov/ • Free credit reports: https://www.annualcreditreport.com/`
  ];

  const systemPrompt = `
You are "Elena", an Executive Real Estate Strategist writing for a U.S. military client.
Write EXACTLY 5 short paragraphs (no headings), addressing the client by Rank + Last Name if provided.
Use the client's Financial Health Grade (A–F) to tune risk guidance and aggressiveness of recommendations.
Avoid jargon; use whole-dollar amounts; keep it crisp and respectful.

Rules:
- P1: Greet with Rank + Last Name; state purpose; mention archetype in one sentence.
- P2: Show housing lane (28–33% of monthly income). Use the provided assumedIncomeMonthly. Render laneMin/laneMax in USD.
- P3: Top 2–3 risks tuned to FH Grade and scores (e.g., if FH=D/F, emphasize reserves, DTI, payment discipline; if FH=A/B, allow targeted flexibility). Include any visual preference note in natural language.
- P4: Concrete playbook: age window (5–10 yrs or quality renovation), inspection strategy, trade-offs (hosting/open plan vs extra bedroom), and upfront “must-haves”.
- P5: Closing with next steps + 1–2 credible links (CFPB and AnnualCreditReport).
Tone: warm, concise, respectful; military-appropriate.`;

  const userPrompt = `
INPUT:
${JSON.stringify({
  profile: {
    first: String(profile.firstName || "").trim() || "Client",
    last,
    bedrooms: Number(profile.bedrooms || 0),
    budgetMax: Number(profile.budgetMax || 0),
    setting: String(profile.setting || "city"),
    safetyPriority: Number(profile.safetyPriority || 3)
  },
  military: {
    rankTitle,
    rankPaygrade: military.rankPaygrade || "",
    yearsInService: Number(military.yearsInService || 0),
    monthlyBasePay: Math.round(assumedIncomeMonthly)
  },
  finance: { fhGrade },
  scores, archetype, psych,
  visual: { styleVsPrice },
  computed: {
    assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
    housingLaneMin: Math.round(lane.laneMin),
    housingLaneMax: Math.round(lane.laneMax),
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
        fhGrade,
        rankTitle,
        assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
        lane: { minMonthly: Math.round(lane.laneMin), maxMonthly: Math.round(lane.laneMax) },
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
        fallback: true, archetype, scores, fhGrade, rankTitle,
        assumedIncomeMonthly: Math.round(assumedIncomeMonthly),
        lane: { minMonthly: Math.round(lane.laneMin), maxMonthly: Math.round(lane.laneMax) }
      }
    });
  }
};
