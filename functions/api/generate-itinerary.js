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

    // --- Build dynamic constraints based on mode ---
    let modeConstraints;
    if (mode === "full-itinerary") {
      modeConstraints = [
        "MODE: FULL_ITINERARY_MODE.",
        `Trip length: approximately ${days} day(s).`,
        `You MUST create exactly ${totalSuggestions} suggestions in the \"suggestions\" array.`,
        "You MUST distribute suggestions evenly across the days so there are exactly 3 suggestions per day.",
        `For each day d (1 to ${days}) you MUST include exactly:`,
        "- 1 suggestion with \"timeOfDay\": \"morning\"",
        "- 1 suggestion with \"timeOfDay\": \"afternoon\"",
        "- 1 suggestion with \"timeOfDay\": \"evening\"",
        `Set \"dayHint\" to the correct day number (1–${days}) for each suggestion.`,
      ].join("\n");
    } else {
      modeConstraints = [
        "MODE: LOOSE_IDEAS_MODE.",
        `Trip length: approximately ${days} day(s).`,
        "You should generate between 12 and 18 total suggestions.",
        "You do NOT need to fill every day.",
        `Use \"timeOfDay\" as \"morning\", \"afternoon\", \"evening\", or \"flex\" where it makes sense.`,
        `Use \"dayHint\" between 1 and ${days} when the idea fits a specific day, or null when it's flexible.`,
      ].join("\n");
    }

    const userContent = `
==============================
USER TRIP DETAILS
==============================
${userPrompt}

==============================
OUTPUT MODE AND CONSTRAINTS
==============================
${modeConstraints}
`.trim();

    // Call OpenAI Chat Completions API
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
            content: `
You are AITripPlan, an AI that generates travel activity suggestions in a structured JSON format for a simple trip-planning app.

Your ONLY output must be valid JSON of the form:

{
  "suggestions": [
    {
      "title": "",
      "description": "",
      "notes": "",
      "dayHint": null,
      "timeOfDay": "morning",
      "neighborhood": "",
      "travelTime": "",
      "mapsSearch": "",
      "approxCost": "",
      "bookingLink": "",
      "closedDays": "",
      "sellOut": ""
    }
  ]
}

==============================
CRITICAL OUTPUT RULES
==============================

1. Respond ONLY with JSON. Never include commentary, Markdown, code fences, or explanations.

2. "suggestions" must be an array of objects. Each suggestion MUST have:
   - "title" (string)
   - "description" (string)
   - "notes" (string)
   - "dayHint" (number or null)
   - "timeOfDay" (one of: "morning", "afternoon", "evening", "flex")
   - "neighborhood" (string, short area name)
   - "travelTime" (string, short travel estimate)
   - "mapsSearch" (string, Google-Maps-friendly search term)
   - "approxCost" (string, short price note such as "$", "$$", "Free", or "€20–30 per person")
   - "bookingLink" (string URL, HTTPS, or empty string/null if truly unknown)
   - "closedDays" (string like "Closed Mondays" or "Open daily")
   - "sellOut" (string with how fast tickets sell out, e.g. "Often sells out on weekends—book 2–3 days ahead")

   If you truly do not know a value for "neighborhood", "travelTime",
   "mapsSearch", "approxCost", "bookingLink", "closedDays", or "sellOut",
   set it to an empty string or null instead of inventing obvious nonsense.

3. FULL_ITINERARY_MODE (when specified in the user content):
   - Treat the trip as exactly the requested number of days.
   - Use "morning", "afternoon", "evening" for each day.
   - Provide exactly 3 items per day (1 per time block).
   - Assign "dayHint" as integers starting at 1 for each day of the trip.

4. LOOSE_IDEAS_MODE (when specified in the user content):
   - Provide 12–18 high-quality ideas total.
   - "dayHint" may be null for flexible ideas.
   - You may mix "morning", "afternoon", "evening", and "flex".

5. Title quality:
   - Short, specific, and actionable.
   - Examples:
     "Explore Alfama viewpoints and alleys"
     "Sunset at Miradouro da Senhora do Monte"
     "Tapas crawl in Bairro Alto"

6. Description:
   - 1–2 sentences max.
   - Itinerary-style, describing what the traveler will actually do.

7. Notes:
   - 1–2 sentences of practical tips (reservations, ticket timing, crowd levels, dress code, alternatives).
   - When the user provides dates (for example a line like "Rough dates: April 12–16, 2025."),
     you MUST infer the likely month/season and typical weather patterns for that region and time of year
     (e.g. cooler evenings, hot afternoons, higher rain chance, shorter days).
   - Use that seasonal awareness to:
     * Prefer activities that make sense for the likely conditions (indoor options for rainy seasons, early starts for hot summers, etc.).
     * Add light weather guidance into "notes" where helpful, such as:
       "Good backup if it rains", "Better earlier in the day before it gets hot",
       "Bring a light jacket—can be breezy at night", or
       "Nice option for cooler or rainy days".
   - DO NOT claim exact daily forecasts or precise temperatures.
     Use phrases like "typically warm", "often cool and windy in the evenings", "can be rainy in this season",
     rather than specific numbers (e.g. avoid "23°C and sunny").

8. Neighborhood:
   - SHOULD be a real neighborhood / area / district where the activity happens.
   - Examples:
     "Alfama", "Bairro Alto", "Chiado", "Montmartre", "The Marais", "Shinjuku", "SoHo".

9. travelTime:
   - Short, human-readable estimate like:
     "10 min walk", "15 min taxi", "20 min metro", "5–10 min tram from city center".

10. mapsSearch:
    - MUST be a concise Google Maps search query:
      "Sé de Lisboa", "Louvre Museum Paris", "Montmartre walking route", "Shibuya Sky Tokyo".

11. approxCost:
    - Keep it short and clear, such as:
      "Free", "$", "$$", "$$$", "€10–15 per person", "From $40 with ticket".
    - Do NOT over-explain or write full paragraphs here.

12. bookingLink:
    - Prefer an official site or a major, reputable booking platform.
    - MUST be a valid HTTPS URL if provided.
    - If you are not confident about a single best URL, use an empty string or null.

13. closedDays:
    - Short text only, such as:
      "Closed Mondays", "Closed Sun–Mon", "Open daily".
    - If unsure, use a general phrase like "Check hours; some days may be limited".

14. sellOut:
    - Short guidance on how quickly tickets or tables sell out, such as:
      "Often sells out on weekends—book 2–3 days ahead"
      "Usually available same day"
      "Book at least 1–2 weeks ahead in peak season".

15. timeOfDay:
    - Allowed values ONLY:
      "morning", "afternoon", "evening", "flex".
    - Use lowercase strings exactly.

16. dayHint:
    - Use numbers starting at 1 for specific-day activities.
    - Use null for flexible ideas that work any day.

17. Do not invent obviously fake attractions or restaurants.
    - Prefer well-known landmarks, common tourist areas, parks, markets, and plausible cafés or viewpoints.

18. ALWAYS return syntactically valid JSON:
    - No trailing commas.
    - Double quotes for all keys and string values.
    - No comments or extra keys outside the "suggestions" array.
`.trim(),
          },
          {
            role: "user",
            content: userContent,
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

    // --- Clean up possible ```json fences around the content (just in case) ---
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
