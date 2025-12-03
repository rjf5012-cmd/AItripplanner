// functions/api/generate-itinerary.js

export async function onRequest({ request, env }) {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed (POST only)" }, 405);
    }

    const apiKey = env && env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
        500
      );
    }

    // --- Parse body ---
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse(
        { error: "Invalid JSON body in request" },
        400
      );
    }

    const userPrompt =
      body && typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!userPrompt) {
      return jsonResponse(
        { error: "Invalid request: 'prompt' is required" },
        400
      );
    }

    const safePrompt = userPrompt.slice(0, 6000);

    // --- Call OpenAI ---
    let openAiRes;
    try {
      openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // change if your key uses a different model
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are an expert travel planner for a drag-and-drop trip planner. " +
                "Respond ONLY with valid JSON of the form {\"suggestions\":[{...}]} " +
                "with each suggestion having keys: id, title, timeOfDay, dayHint, description, notes.",
            },
            {
              role: "user",
              content: safePrompt,
            },
          ],
          temperature: 0.8,
          max_tokens: 900,
        }),
      });
    } catch (e) {
      return jsonResponse(
        { error: "Network error reaching OpenAI", details: String(e) },
        502
      );
    }

    if (!openAiRes.ok) {
      const text = await openAiRes.text().catch(() => "");
      return jsonResponse(
        {
          error: "OpenAI returned an error",
          upstreamStatus: openAiRes.status,
          upstreamBody: text,
        },
        502
      );
    }

    // --- Parse OpenAI JSON ---
    let openAiJson;
    try {
      openAiJson = await openAiRes.json();
    } catch (e) {
      return jsonResponse(
        { error: "Failed to parse JSON from OpenAI", details: String(e) },
        502
      );
    }

    const content = openAiJson?.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      return jsonResponse(
        {
          error: "Unexpected OpenAI response format (content is not a string)",
          raw: openAiJson,
        },
        502
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return jsonResponse(
        {
          error: "OpenAI returned non-JSON content",
          raw: content,
          details: String(e),
        },
        502
      );
    }

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : [];

    if (!suggestions.length) {
      return jsonResponse(
        {
          error: "OpenAI returned no suggestions",
          raw: parsed,
        },
        502
      );
    }

    // Normalize a bit, just in case
    const normalized = suggestions.map((s, idx) => {
      const id =
        typeof s.id === "string" && s.id.trim()
          ? s.id
          : "ai-suggestion-" + (idx + 1);

      const tod =
        s.timeOfDay === "morning" ||
        s.timeOfDay === "afternoon" ||
        s.timeOfDay === "evening" ||
        s.timeOfDay === "flex"
          ? s.timeOfDay
          : "flex";

      return {
        id,
        title: s.title || "Activity",
        timeOfDay: tod,
        dayHint:
          typeof s.dayHint === "number" && Number.isFinite(s.dayHint)
            ? s.dayHint
            : null,
        description: s.description || "",
        notes: s.notes || "",
      };
    });

    return jsonResponse({ suggestions: normalized }, 200);
  } catch (err) {
    return jsonResponse(
      {
        error: "Unexpected server error",
        details: String(err),
      },
      500
    );
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
