// netlify/functions/pay-tables.js

import fs from "fs";
import path from "path";

export const handler = async () => {
  try {
    // Resolve path to the JSON file relative to the function directory
    const filePath = path.resolve("netlify/functions/data/militaryPayTables.json");

    // Load the file
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
      },
      body: JSON.stringify({
        ok: true,
        version: json.version,
        updated: json.updated,
        data: json
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        ok: false,
        error: "Unable to load military pay tables.",
        details: err.message
      })
    };
  }
};
