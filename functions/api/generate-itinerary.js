// functions/api/generate-itinerary.js

export async function onRequest({ request, env }) {
  // Only allow POST
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed (POST only)" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const apiKey = env && env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not set in environment variables" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // --- Read prompt from body (with a safe fallback) ---
  let prompt = "Plan a short 2-day city trip with family-friendly activities.";
  try {
    const bodyText = await request.text();
    if (bodyText) {
      const body = JSON.parse(bodyText);
      if (body && typeof body.prompt === "string") {
        prompt = body.prompt.trim();
      }
    }
  } catch (e) {
    // If JSON parse fails, we just keep the default prompt
  }

  // --- Build OpenAI payload (keep strings simple to avoid syntax issues) ---
  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are an expert travel planner for a drag-and-drop itinerary builder. " +
          "Respond ONLY with JSON. The JSON must be an object with a 'suggestions' array " +
          "containing at most 10 activities. Each activity object must have: " +
          "id (string), title (string), timeOfDay (one of 'morning','afternoon','evening','flex'), " +
          "dayHint (number or null), description (short string), and notes (short string). " +
          "No other keys. No text before or after the JSON."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.8,
    max_tokens: 500
  };

  try {
    // --- Call OpenAI ---
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const rootText = await res.text();

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: "OpenAI returned an error",
          upstreamStatus: res.status,
          upstreamBody: rootText
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // --- Parse OpenAI root JSON ---
    let rootJson;
    try {
      rootJson = JSON.parse(rootText);
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "Could not parse root JSON from OpenAI",
          upstreamBody: rootText
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const choices = rootJson && rootJson.choices;
    const firstChoice = choices && choices[0];
    const message = firstChoice && firstChoice.message;
    const content = message && message.content;

    if (typeof content !== "string") {
      return new Response(
        JSON.stringify({
          error: "Unexpected OpenAI response format (content is not a string)",
          raw: rootJson
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // --- Parse the JSON string inside message.content ---
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "OpenAI content was not valid JSON",
          rawContent: content,
          details: String(e)
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : [];

    if (!suggestions.length) {
      return new Response(
        JSON.stringify({
          error: "OpenAI returned no suggestions",
          raw: parsed
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // --- Normalize into a clean array for the frontend ---
    const normalized = suggestions.map(function (s, index) {
      const id =
        s && typeof s.id === "string" && s.id.trim()
          ? s.id
          : "ai-suggestion-" + (index + 1);

      let tod = "flex";
      if (s && typeof s.timeOfDay === "string") {
        const val = s.timeOfDay.toLowerCase();
        if (
          val === "morning" ||
          val === "afternoon" ||
          val === "evening" ||
          val === "flex"
        ) {
          tod = val;
        }
      }

      let dayHint = null;
      if (s && typeof s.dayHint === "number" && isFinite(s.dayHint)) {
        dayHint = s.dayHint;
      }

      return {
        id: id,
        title: s && s.title ? String(s.title) : "Activity",
        timeOfDay: tod,
        dayHint: dayHint,
        description: s && s.description ? String(s.description) : "",
        notes: s && s.notes ? String(s.notes) : ""
      };
    });

    return new Response(
      JSON.stringify({ suggestions: normalized }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (err) {
    // Catch any unexpected runtime error
    return new Response(
      JSON.stringify({
        error: "Unexpected server error",
        details: String(err)
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
