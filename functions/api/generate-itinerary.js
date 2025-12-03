// functions/api/generate-itinerary.js

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Simple GET health-check so you can sanity-check in the browser
export async function onRequestGet({ env }) {
  return jsonResponse({
    ok: true,
    method: "GET",
    path: "/api/generate-itinerary",
    hasOpenAIKey: !!env.OPENAI_API_KEY,
    note: "AITripPlan generate-itinerary health-check",
  });
}

// Main POST handler that the frontend uses
export async function onRequestPost({ request, env }) {
  try {
    if (!env.OPENAI_API_KEY) {
      return jsonResponse(
        { error: "OPENAI_API_KEY is not configured in environment." },
        500
      );
    }

    const body = await request.json().catch(() => ({}));
    const userPrompt = body?.prompt;

    if (!userPrompt || typeof userPrompt !== "string") {
      return jsonResponse(
        { error: "Missing or invalid 'prompt' in request body." },
        400
      );
    }

    // --- Derive number of days from the prompt (Trip length: X days.) ---
    let inferredDays = 3; // sensible default
    const match = userPrompt.match(/Trip length:\s*(\d+)\s*days/i);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        inferredDays = parsed;
      }
    }

    // Hard cap so we don't ask for 30 * 3 = 90 suggestions
    const days = Math.min(Math.max(inferredDays, 1), 7);
    const totalSuggestions = days * 3;

    // --- Build an augmented prompt that the model can follow easily ---
    const itineraryInstructions = [
      `The trip should last exactly ${days} day(s).`,
      `You MUST return exactly ${totalSuggestions} suggestions in the "suggestions" array.`,
      `Distribute suggestions evenly across the days so there are exactly 3 suggestions per day.`,
      `For each day d (1 to ${days}) you MUST include exactly:`,
      `- 1 suggestion with "timeOfDay": "morning"`,
      `- 1 suggestion with "timeOfDay": "afternoon"`,
      `- 1 suggestion with "timeOfDay": "evening"`,
      `Set "dayHint" to the correct day number (1–${days}) for each suggestion.`,
      `Keep titles short and scannable; keep description and notes concise (1–2 sentences each).`,
    ].join("\n");

    const combinedPrompt =
      userPrompt +
      "\n\n" +
      "Trip structure constraints:\n" +
      itineraryInstructions;

    // Call OpenAI Chat Completions API – same pattern as your working /api/gifts
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert travel planner for a simple itinerary builder. " +
              "You ALWAYS respond with valid JSON only, no extra text. " +
              "Return a single JSON object with a 'suggestions' array. " +
              "Each suggestion must have: " +
              "id (string), title (string), timeOfDay ('morning'|'afternoon'|'evening'|'flex'), " +
              "dayHint (number or null), description (string), and notes (string).",
          },
          {
            role: "user",
            content: combinedPrompt,
          },
        ],
        temperature: 0.7,
      }),
    });

    const raw = await openaiRes.text().catch(() => "");

    if (!openaiRes.ok) {
      console.error("OpenAI error:", openaiRes.status, raw);
      return jsonResponse(
        {
          error: "Error from OpenAI API.",
          status: openaiRes.status,
        },
        502
      );
    }

    let openaiJson;
    try {
      openaiJson = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse OpenAI root JSON:", e, raw);
      return jsonResponse(
        { error: "Failed to parse OpenAI root JSON." },
        502
      );
    }

    let message = openaiJson?.choices?.[0]?.message?.content;
    if (!message || typeof message !== "string") {
      return jsonResponse(
        { error: "No content returned from OpenAI." },
        502
      );
    }

    // --- Clean up possible ```json fences around the content ---
    let cleaned = message.trim();
    if (cleaned.startsWith("```")) {
      // Remove leading ```json or ``` fence
      const firstNewline = cleaned.indexOf("\n");
      if (firstNewline !== -1) {
        cleaned = cleaned.slice(firstNewline + 1);
      }
      // Remove trailing ```
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON content:", e, cleaned);
      return jsonResponse(
        { error: "Failed to parse AI response as JSON." },
        502
      );
    }

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : [];

    // Optional: light sanity check on count; don't fail, just return what we have
    // (you can enforce stricter behavior later if you want)
    if (!suggestions.length) {
      console.warn("AI returned zero suggestions.", parsed);
    }

    return jsonResponse({ suggestions });
  } catch (err) {
    console.error("Unexpected error in /api/generate-itinerary:", err);
    return jsonResponse(
      { error: "Unexpected server error." },
      500
    );
  }
}
