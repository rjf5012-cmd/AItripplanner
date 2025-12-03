// functions/api/generate-itinerary.js

export async function onRequestPost({ request, env }) {
  try {
    // Parse JSON body safely
    const body = await request.json().catch(() => ({}));
    const userPrompt = body?.prompt;

    // Basic validation
    if (!userPrompt || typeof userPrompt !== "string") {
      return jsonResponse(
        { error: "Missing or invalid 'prompt' in request body." },
        400
      );
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse(
        { error: "OPENAI_API_KEY is not configured in environment." },
        500
      );
    }

    // Call OpenAI Chat Completions API
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini", // same style as your working gifts.js site
          messages: [
            {
              role: "system",
              content:
                "You are an expert travel planner for a simple itinerary builder. " +
                "You ALWAYS respond with valid JSON only, no extra text. " +
                "The JSON must be an object with a 'suggestions' array (max 10 items). " +
                "Each suggestion must be an object with: " +
                "id (string), title (string), timeOfDay (one of 'morning','afternoon','evening','flex'), " +
                "dayHint (number or null), description (short string), notes (short string). " +
                "No other keys anywhere.",
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          temperature: 0.8,
          max_tokens: 600,
        }),
      }
    );

    if (!openaiRes.ok) {
      const text = await openaiRes.text().catch(() => "");
      console.error("OpenAI error in /api/generate-itinerary:", openaiRes.status, text);

      return jsonResponse(
        {
          error: "Error from OpenAI API.",
          status: openaiRes.status,
        },
        502
      );
    }

    const openaiJson = await openaiRes.json();
    const message = openaiJson?.choices?.[0]?.message?.content;

    if (!message || typeof message !== "string") {
      return jsonResponse(
        { error: "No content returned from OpenAI." },
        502
      );
    }

    // OpenAI is instructed to return JSON as a string -> parse it
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON:", e, message);
      return jsonResponse(
        { error: "Failed to parse AI response as JSON." },
        502
      );
    }

    const rawSuggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : [];

    // Normalize to the structure your frontend expects
    const suggestions = rawSuggestions.map((s, index) => {
      const id =
        s && typeof s.id === "string" && s.id.trim()
          ? s.id.trim()
          : `ai-suggestion-${index + 1}`;

      let timeOfDay = "flex";
      if (s && typeof s.timeOfDay === "string") {
        const v = s.timeOfDay.toLowerCase();
        if (["morning", "afternoon", "evening", "flex"].includes(v)) {
          timeOfDay = v;
        }
      }

      let dayHint = null;
      if (s && typeof s.dayHint === "number" && isFinite(s.dayHint)) {
        dayHint = s.dayHint;
      }

      return {
        id,
        title: s && s.title ? String(s.title) : "Activity",
        timeOfDay,
        dayHint,
        description: s && s.description ? String(s.description) : "",
        notes: s && s.notes ? String(s.notes) : "",
      };
    });

    return jsonResponse({ suggestions });
  } catch (err) {
    console.error("Unexpected error in /api/generate-itinerary:", err);
    return jsonResponse(
      { error: "Unexpected server error." },
      500
    );
  }
}

// Same helper you’re using in gifts.js
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
