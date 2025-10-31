// netlify/functions/send-code.js
export async function handler(event) {
  // Handle preflight OPTIONS
  if (event.httpMethod === "OPTIONS") {
    return new Response("", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json"
      }
    });
  }

  // Test route — no Supabase, no Resend
  return new Response(JSON.stringify({ ok: true, message: "Function is alive." }), {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json"
    }
  });
}
