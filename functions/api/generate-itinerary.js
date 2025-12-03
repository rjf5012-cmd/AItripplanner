// functions/api/generate-itinerary.js

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed (POST only)" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // --- Parse body (we don't really *need* it for the fallback, but OpenAI will) ---
  let body = null;
  try {
    body = await request.json();
  } catch (e) {
    // If body is bad, we can still give generic suggestions
  }

  const userPrompt =
    body && typeof body.prompt === "string" ? body.prompt.trim() : "";

  // --- Fallback suggestions (always safe) ---
  const fallbackSuggestions = [
    {
      id: "s1",
      title: "Old Town Walking Tour",
      timeOfDay: "morning",
      dayHint: 1,
      description:
        "Explore the historic center with coffee and pastries along the way.",
      notes: "Wear comfy shoes.",
    },
    {
      id: "s2",
      title: "Local Market & Street Food",
      timeOfDay: "afternoon",
      dayHint: 1,
      description:
        "Wander through the main market and sample local snacks from different vendors.",
      notes: "Bring some small cash.",
    },
    {
      id: "s3",
      title: "Sunset Viewpoint",
      timeOfDay: "evening",
      dayHint: 1,
      description:
        "Head to a popular lookout point to watch the sunset and take photos.",
      notes: "Great spot for golden-hour pictures.",
    },
  ];

  // If there's no OpenAI key, just return the fallback immediately
  const apiKey = env && env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      {
        suggestions: fallbackSuggestions,
        warning: "OPENAI_API_KEY not set; using fallback suggestions.",
      },
      200
    );
  }

  // --- Try OpenAI; fall back on *any* failure ---
  try {
    // Build a safe prompt
    const safePrompt = (userPrompt || "").slice(0, 6000);

    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // change if your account uses a different model
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an expert travel planner for a drag-and-drop trip planner. " +
              "Respond ONLY with valid JSON matching this schema:\n" +
              "{\n" +
              '  "suggestions": [\n' +
              "    {\n" +
              '      "id": "string-unique-id",\n' +
              '      "title": "short activity title",\n' +
              '      "timeOfDay": "morning" | "afternoon" | "evening" | "flex",\n" +
              '      "dayHint": number | null,\n' +
              '      "description": "1–3 sentence description",\n' +
              '      "notes": "optional quick notes for travelers"\n' +
              "    }\n" +
              "  ]\n" +
              "}\n" +
              "Do NOT include any other keys or extra text.",
          },
          {
            role: "user",
            content: safePrompt || "Create a 1-day highlight itinerary.",
          },
        ],
        temperature: 0.8,
        max_tokens: 900,
      }),
    });

    if (!openAiRes.ok) {
      // If OpenAI complains (bad key, bad model, etc.) -> fallback
      return jsonResponse(
        {
          suggestions: fallbackSuggestions,
          warning:
            "OpenAI request failed (status " + openAiRes.status + "); using fallback suggestions.",
        },
        200
      );
    }

    let openAiData;
    try {
      openAiData = await openAiRes.json();
    } catch (e) {
      return jsonResponse(
        {
          suggestions: fallbackSuggestions,
          warning: "Could not parse OpenAI JSON; using fallback suggestions.",
        },
        200
      );
    }

    // Safely pull out the message content
    const choices = openAiData && openAiData.choices;
    const first = choices && choices[0];
    const message = first && first.message;
    let parsed = null;

    if (message && typeof message.content === "string") {
      try {
        parsed = JSON.parse(message.content);
      } catch (e) {
        return jsonResponse(
          {
            suggestions: fallbackSuggestions,
            warning:
              "OpenAI returned non-JSON content; using fallback suggestions.",
          },
          200
        );
      }
    } else if (message && typeof message.content === "object") {
      parsed = message.content;
    }

    const suggestions =
      parsed && Array.isArray(parsed.suggestions)
        ? parsed.suggestions
        : null;

    if (!suggestions || !suggestions.length) {
      return jsonResponse(
        {
          suggestions: fallbackSuggestions,
          warning: "OpenAI returned no suggestions; using fallback suggestions.",
        },
        200
      );
    }

    // Normalize suggestions and return
    const normalized = suggestions.map(function (s, idx) {
      var id =
        s && typeof s.id === "string" && s.id.trim()
          ? s.id
          : "ai-suggestion-" + (idx + 1);

      var tod =
        s && (s.timeOfDay === "morning" ||
              s.timeOfDay === "afternoon" ||
              s.timeOfDay === "evening" ||
              s.timeOfDay === "flex")
          ? s.timeOfDay
          : "flex";

      return {
        id: id,
        title: (s && s.title) || "Activity",
        timeOfDay: tod,
        dayHint:
          s && typeof s.dayHint === "number" && isFinite(s.dayHint)
            ? s.dayHint
            : null,
        description: (s && s.description) || "",
        notes: (s && s.notes) || "",
      };
    });

    return jsonResponse({ suggestions: normalized }, 200);
  } catch (err) {
    // Any unexpected error → fallback
    return jsonResponse(
      {
        suggestions: fallbackSuggestions,
        warning: "Unexpected error calling OpenAI; using fallback suggestions.",
      },
      200
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
