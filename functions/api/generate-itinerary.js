// functions/api/generate-itinerary.js

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;

  try {
    // Only allow POST
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed (POST only)" }, 405);
    }

    const apiKey = env && env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "OPENAI_API_KEY is not set in environment variables" },
        500
      );
    }

    // ---- Read prompt from body ----
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
      // If body parsing fails, we just fall back to the default prompt
    }

    // ---- Build OpenAI payload ----
    const payload = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert travel planner for a drag-and-drop itinerary builder. " +
            "Reply ONLY with a single JSON object in this exact shape:\n" +
            "{\n" +
            '  "suggestions": [\n' +
            "    {\n" +
            '      "id": "string-id",\n' +
            '      "title": "short activity title",\n' +
            '      "timeOfDay": "morning" | "afternoon" | "evening" | "flex",\n' +
            "      \"dayHint\": number | null,\n" +
            '      "description": "1–3 short sentences (<= 30 words)",\n' +
            '      "notes": "optional quick notes"\n' +
            "    }\n" +
            "  ]\n" +
            "}\n" +
            "Rules:\n" +
            "- Return AT MOST 10 activities.\n" +
            "- No extra text before or after the JSON.\n" +
            "- Keep the entire JSON under 4000 characters."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8,
      max_tokens: 500 // lower to reduce truncation risk
    };

    // ---- Call OpenAI ----
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
      return jsonResponse(
        {
          error: "OpenAI returned an error",
          upstreamStatus: res.status,
          upstreamBody: rootText
        },
        502
      );
    }

    // ---- Parse root JSON ----
    let rootJson;
    try {
      rootJson = JSON.parse(rootText);
    } catch (e) {
      return jsonResponse(
        {
          error: "Could not parse root JSON from OpenAI",
          upstreamBody: rootText
        },
        502
      );
    }

    const choices = rootJson && rootJson.choices;
    const firstChoice = choices && choices[0];
    const message = firstChoice && firstChoice.message;
    const content = message && message.content;

    if (typeof content !== "string") {
      return jsonResponse(
        {
          error: "Unexpected OpenAI response format (content is not a string)",
          raw: rootJson
        },
        502
      );
    }

    // ---- Parse the JSON inside message.content ----
    let planner;
    try {
      planner = JSON.parse(content);
    } catch (e) {
      return jsonResponse(
        {
          error: "OpenAI content was not valid JSON",
          rawContent: content,
          details: String(e)
        },
        502
      );
    }

    const suggestions = Array.isArray(planner.suggestions)
      ? planner.suggestions
      : [];

    if (!suggestions.length) {
      return jsonResponse(
        {
          error: "OpenAI returned no suggestions",
          raw: planner
        },
        502
      );
    }

    // ---- Normalize suggestions ----
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
