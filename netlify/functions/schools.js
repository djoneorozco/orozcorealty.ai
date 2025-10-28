// Schools: combine TEA TAPR (download CSV each year) + NCES attributes (optional)
// ENV (optional):
//   TEA_TAPR_CSV_URL = public CSV/TSV you’ve hosted (district/campus level)
//   NCES_CITY = "SAN ANTONIO"
//   NCES_STATE = "TX"
// This minimal version returns campuses matched by ZIP from your TEA CSV.

export const handler = async (event) => {
  const zip = (event.queryStringParameters?.zip || "").trim();
  if(!zip) return json({ error:"zip required" }, 400);

  const TEA = process.env.TEA_TAPR_CSV_URL || "";
  try {
    let campuses = [];
    if (TEA) {
      const r = await fetch(TEA);
      if (r.ok) {
        const text = await r.text();
        // naive CSV parse (assumes header with columns: CAMPUS_NAME, ZIP, RATING, DISTRICT)
        const rows = text.split(/\r?\n/).map(l=>l.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/));
        const hdr = rows.shift();
        const idxZIP = hdr.findIndex(h=>/zip/i.test(h));
        const idxName = hdr.findIndex(h=>/campus|school/i.test(h));
        const idxDist = hdr.findIndex(h=>/district/i.test(h));
        const idxRate = hdr.findIndex(h=>/rating|score|acct/i.test(h));
        for (const r of rows) {
          if (!r.length) continue;
          const z = (r[idxZIP]||"").replace(/[^0-9]/g,"");
          if (z === zip) {
            campuses.push({
              name: (r[idxName]||"").replace(/^"|"$/g,""),
              district: (r[idxDist]||"").replace(/^"|"$/g,""),
              rating: (r[idxRate]||"").replace(/^"|"$/g,"")
            });
          }
        }
      }
    }
    const ratingNote = "Ratings reflect the most recent TEA Accountability release available in the TAPR dataset you configured.";
    return json({ zip, campuses, ratingNote, source: TEA || "Upload TEA_TAPR_CSV_URL (public CSV) for live results." });
  } catch (e) {
    return json({ zip, campuses: [], ratingNote:"", source:"", error: e.message }, 500);
  }
};

function json(body, status=200){ return { statusCode: status, headers: { "content-type":"application/json" }, body: JSON.stringify(body) } }
