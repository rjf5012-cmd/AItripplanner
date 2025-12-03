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

    // Call OpenAI Chat Completions API – same pattern as your working /api/gifts
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini", // same model family you're already using successfully
        messages: [
          {
            role: "system",
            content:
              "You are an expert travel planner for a simple itinerary builder. " +
              "You ALWAYS respond with valid JSON only, no extra text before or after. " +
              "Return a single JSON object with a 'suggestions' array. " +
              "Each suggestion object MUST have EXACTLY these keys: " +
              "id (string), title (string), timeOfDay (one of 'morning','afternoon','evening','flex'), " +
              "dayHint (number or null), description (short string), and notes (short string). " +
              "If the user prompt includes a trip length in days (for example: 'Trip length: 4 days.'), " +
              "you MUST assume that is the number of days in the itinerary. " +
              "In that case, you MUST: " +
              "(1) assign dayHint values as integers from 1 up to that trip length, " +
              "(2) spread suggestions across ALL days so that every day from 1 to the trip length has at least one suggestion, and " +
              "(3) aim for about 3 suggestions per day (morning, afternoon, evening). " +
              "The total number of suggestions when a trip length is given should be at least 2 times the number of days and at most 18. " +
              "If no trip length is specified, return 8–10 general suggestions with dayHint set to null.",
          },
          {
            role: "user",
            content: userPrompt,
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

    const message = openaiJson?.choices?.[0]?.message?.content;
    if (!message || typeof message !== "string") {
      return jsonResponse(
        { error: "No content returned from OpenAI." },
        502
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON content:", e, message);
      return jsonResponse(
        { error: "Failed to parse AI response as JSON." },
        502
      );
    }

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : [];

    return jsonResponse({ suggestions });
  } catch (err) {
    console.error("Unexpected error in /api/generate-itinerary:", err);
    return jsonResponse(
      { error: "Unexpected server error." },
      500
    );
  }
}
