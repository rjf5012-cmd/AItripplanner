// functions/api/generate-itinerary.js

export async function onRequest({ request, env }) {
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
          model: "gpt-4o-mini", // change if your account doesn't have this model
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are an expert travel planner. " +
                "Return ONLY valid JSON with an array of activity suggestions for a drag-and-drop trip planner.",
            },
            {
              role: "user",
              content:
                safePrompt +
                "\n\nReturn JSON in this exact shape:\n" +
                "{\n" +
                '  \"suggestions\": [\n' +
                "    {\n" +
                '      \"id\": \"string-unique-id\",\n' +
                '      \"title\": \"short activity title\",\n' +
                '      \"timeOfDay\": \"morning\" | \"afternoon\" | \"evening\" | \"flex\",\n' +
                "      \"dayHint\": 1,\n" +
                '      \"description\": \"1–3 sentence description\",\n' +
                '      \"notes\": \"optional quick notes for travelers\"\n' +
                "    }\n" +
                "  ]\n" +
                "}\n" +
                "Do NOT include any extra keys, text, or explanations outside this JSON.",
            },
          ],
          temperature: 0.8,
          max_tokens: 900,
        }),
      });
    } catch (e) {
      console.error("[generate-itinerary] Fetch to OpenAI threw:", e);
      return jsonResponse(
        { error: "Could not reach AI provider. Try again later." },
        502
      );
    }

    if (!openAiRes.ok) {
      const errorText = await openAiRes.text().catch(() => "");
      console.error(
        "[generate-itinerary] OpenAI error:",
        openAiRes.status,
        errorText
      );
      return jsonResponse(
        {
          error: "Upstream AI request failed.",
          upstreamStatus: openAiRes.status,
          upstreamBody: errorText,
        },
        502
      );
    }

    const openAiData = await openAiRes.json();
    const raw = openAiData?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      console.error(
        "[generate-itinerary] Failed to parse JSON from model:",
        e,
        raw
      );
      return jsonResponse(
        { error: "AI returned invalid JSON. Please try again." },
        502
      );
    }

    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
      : [];

    if (!suggestions.length) {
      return jsonResponse(
        { error: "No suggestions returned. Try again with more details." },
        502
      );
    }

    return jsonResponse({ suggestions }, 200);
  } catch (err) {
    console.error("[generate-itinerary] Unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error. Please try again." },
      500
    );
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
