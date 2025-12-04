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
    const mode = body?.mode === "full-itinerary" ? "full-itinerary" : "ideas";

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

    // --- Build the actual prompt sent to the model ---
    let combinedPrompt = userPrompt;

    if (mode === "full-itinerary") {
      const itineraryInstructions = [
        `The trip should last exactly ${days} day(s).`,
        `You MUST return exactly ${totalSuggestions} suggestions in the "suggestions" array.`,
        `Distribute suggestions evenly across the days so there are exactly 3 suggestions per day.`,
        `For each day d (1 to ${days}) you MUST include exactly:`,
        `- 1 suggestion with "timeOfDay": "morning"`,
        `- 1 suggestion with "timeOfDay": "afternoon"`,
        `- 1 suggestion with "timeOfDay": "evening"`,
        `Set "dayHint" to the correct day number (1–${days}) for each suggestion.`,
        `Keep titles short and scannable; keep description and notes concise.`,
      ].join("\n");

      combinedPrompt =
        userPrompt +
        "\n\nTrip structure constraints (full itinerary mode):\n" +
        itineraryInstructions;
    } else {
      // "Ideas" mode – more relaxed, just gentle structure hints
      const ideasInstructions = [
        `The trip is approximately ${days} day(s) long.`,
        `You do NOT need to fill every day. Focus on high-quality ideas.`,
        `Use "timeOfDay" as "morning", "afternoon", "evening", or "flex" where it makes sense.`,
        `Use "dayHint" between 1 and ${days} when the idea fits a specific day, or null when it's flexible.`,
      ].join("\n");

      combinedPrompt =
        userPrompt +
        "\n\nTrip structure notes (loose ideas mode):\n" +
        ideasInstructions;
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
              "Each suggestion MUST have: " +
              "id (string), title (string), timeOfDay ('morning'|'afternoon'|'evening'|'flex'), " +
              "dayHint (number or null), description (string), and notes (string). " +
              "Use 'description' as a 3–5 sentence itinerary-style explanation in context of the day. " +
              "Use 'notes' as a 1–2 sentence practical/logistical tip (e.g., ticket timing, reservations, dress code). " +
              "Whenever possible you SHOULD ALSO include these extra fields in each suggestion: " +
              "neighborhood (short neighborhood or area name, e.g. 'Alfama'), " +
              "mapsSearch (a concise Google Maps search query a traveler could paste, e.g. 'Se de Lisboa Lisbon'), " +
              "travelTime (a short human-readable estimate like '10–15 min walk from Baixa' or '15 min by metro from city center'). " +
              "Keep neighborhood, mapsSearch, and travelTime short and map-friendly.",
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
      const firstNewline = cleaned.indexOf("\n");
      if (firstNewline !== -1) {
        cleaned = cleaned.slice(firstNewline + 1);
      }
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

    if (!suggestions.length) {
      console.warn("AI returned zero suggestions.", parsed);
    }

    return jsonResponse({ suggestions });
  } catch (err) {
    console.error("Unexpected error in /api/generate-itinerary:", err);
    return jsonResponse({ error: "Unexpected server error." }, 500);
  }
}
