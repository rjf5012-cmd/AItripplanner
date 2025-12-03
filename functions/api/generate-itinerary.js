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
              "dayHint (number or null), description (string), and notes (string). " +
              "If the user prompt includes a line like 'Trip length: X days.', then: " +
              "1) You MUST create at least 3 suggestions per day (one morning, one afternoon, one evening) " +
              "   so the minimum total suggestions is X * 3. " +
              "2) Use dayHint as an integer from 1 to X indicating which day the activity fits best. " +
              "3) You may optionally add extra flexible ('flex') ideas with dayHint = null that work on any day. " +
              "If no trip length is given, assume 3 days and still create at least 9 suggestions. " +
              "The final response MUST be valid JSON and MUST NOT include markdown, comments, or extra text.",
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        temperature: 0.7,
        // You can tweak this if you ever need more/less detail
        max_tokens: 900,
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
