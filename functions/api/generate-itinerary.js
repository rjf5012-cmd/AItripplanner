// functions/api/generate-itinerary.js

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[generate-itinerary] Missing OPENAI_API_KEY env var");
      return jsonResponse(
        { error: "Server misconfiguration: missing OPENAI_API_KEY" },
        500
      );
    }

    const body = await request.json().catch((e) => {
      console.error("[generate-itinerary] Invalid JSON body", e);
      return null;
    });

    if (!body) {
      return jsonResponse(
        { error: "Invalid JSON body in request." },
        400
      );
    }

    const userPrompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!userPrompt) {
      return jsonResponse(
        { error: "Invalid request: 'prompt' is required." },
        400
      );
    }

    const safePrompt = userPrompt.slice(0, 6000);

    let openAiRes;
    try {
      openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // change if your key doesn't have this model
          response_format: { type: "json_object" },
          messages: [
            {
              role: "
