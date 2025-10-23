// netlify/functions/stage.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
        body: "ok",
      };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: true,
          note: "RE-Defined proxy: POST JSON to generate images.",
          expects: {
            json: {
              input_image_url: "https://...",
              room_type: "livingroom",
              design_style: "modern",
            },
          },
          env: {
            upstream: !!process.env.STAGE_API_URL,
            hasKey: !!process.env.DECOR8_API_KEY,
          },
        }),
      };
    }

    // Parse the incoming JSON body
    const { input_image_url, room_type, design_style } = JSON.parse(event.body);

    // Validate input
    if (!input_image_url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing input_image_url" }),
      };
    }

    // Build the request body for Decor8 API
    const decor8Payload = {
      input_image_url,
      room_type: room_type || "livingroom",
      design_style: design_style || "modern",
    };

    const response = await fetch(process.env.STAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DECOR8_API_KEY}`,
      },
      body: JSON.stringify(decor8Payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "Upstream error",
          detail: data,
        }),
      };
    }

    // Success
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ok: true,
        message: "Image generated successfully",
        decor8Response: data,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Server exception",
        detail: error.message,
      }),
    };
  }
};
