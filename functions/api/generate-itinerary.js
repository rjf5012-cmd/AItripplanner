// functions/api/generate-itinerary.js

export async function onRequest({ request, env }) {
  try {
    // Only allow POST
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed (POST only)" }, 405);
    }

    // Check API key
    const apiKey = env && env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "OPENAI_API_KEY is not set in environment variables" },
        500
      );
    }

    // Read body as text then JSON-parse
    const bodyText = await request.text();
    let prompt = "";
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed.prompt === "string") {
        prompt = parsed.prompt.trim();
      }
    } catch (e) {
      // ignore, prompt stays ""
    }
    if (!prompt) {
      prompt = "Create a short 1-day highlight itinerary for a popular city.";
    }

    // Call OpenAI
    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // if this errors, swap to "gpt-4o"
        messages: [
          {
            role: "system",
            content:
              "You are a travel planner. Reply with JSON ONLY. " +
              'Format: {"suggestions":[{"id":"id1","title":"..","timeOfDay":"morning","dayHint":1,"description":"..","notes":".."}]}'
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 900,
        response_format: { type: "json_object" }
      })
    });

    const openAiText = await openAiRes.text();

    // Parse OpenAI response root JSON
    let openAiJson;
    try {
      openAiJson = JSON.parse(openAiText);
    } catch (e) {
      return jsonResponse(
        {
          error: "Could not parse JSON from OpenAI",
          upstreamStatus: openAiRes.status,
          upstreamBody: openAiText
        },
        502
      );
    }

    // Handle JSON-mode shapes
    let planner = null;
    if (
      openAiJson &&
      openAiJson.choices &&
      openAiJson.choices[0] &&
      openAiJson.choices[0].message
    ) {
      const msg = openAiJson.choices[0].message;

      if (msg.parsed && typeof msg.parsed === "object") {
        // Some JSON modes put parsed object here
        planner = msg.parsed;
      } else if (typeof msg.content === "string") {
        try {
          planner = JSON.parse(msg.content);
        } catch (e) {
          return jsonResponse(
            {
              error: "OpenAI content was not valid JSON",
              rawContent: msg.content,
              details: String(e)
            },
            502
          );
        }
      } else if (typeof msg.content === "object") {
        planner = msg.content;
      }
    }

    if (!planner || typeof planner !== "object") {
      return jsonResponse(
        {
          error: "Unexpected OpenAI response format",
          upstreamStatus: openAiRes.status,
          upstreamBody: openAiJson
        },
        502
      );
    }

    const suggestions = Array.isArray(planner.suggestions)
      ? planner.suggestions
      : [];

    if (!suggestions.length) {
      return jsonResponse(
        { error: "OpenAI returned no suggestions", raw: planner },
        502
      );
    }

    // Normalize suggestions
    const normalized = suggestions.map(function (s, index) {
      const id =
        s && typeof s.id === "string" && s.id.trim()
          ? s.id
          : "ai-suggestion-" + (index + 1);

      const tod =
        s &&
        (s.timeOfDay === "morning" ||
          s.timeOfDay === "afternoon" ||
          s.timeOfDay === "evening" ||
          s.timeOfDay === "flex")
          ? s.timeOfDay
          : "flex";

      return {
        id: id,
        title: s && s.title ? s.title : "Activity",
        timeOfDay: tod,
        dayHint:
          s && typeof s.dayHint === "number" && isFinite(s.dayHint)
            ? s.dayHint
            : null,
        description: s && s.description ? s.description : "",
        notes: s && s.notes ? s.notes : ""
      };
    });

    return jsonResponse({ suggestions: normalized }, 200);
  } catch (err) {
    return jsonResponse(
      { error: "Unexpected server error", details: String(err) },
      500
    );
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
