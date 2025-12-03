// functions/api/generate-itinerary.js

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (err) {
    return jsonResponse(
      {
        error: "Worker crashed BEFORE sending a response.",
        details: String(err),
        stack: err?.stack || null
      },
      500
    );
  }
}

async function handleRequest({ request, env }) {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Missing OPENAI_API_KEY (env var not set)" },
        500
      );
    }

    // Parse request JSON
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse(
        { error: "Invalid JSON body", details: String(err) },
        400
      );
    }

    const userPrompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!userPrompt) {
      return jsonResponse(
        { error: "Missing 'prom
