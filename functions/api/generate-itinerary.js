// functions/api/generate-itinerary.js

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (err) {
    // Catch truly unexpected worker-level errors
    return jsonResponse(
      {
        error: "Worker crashed before sending a response.",
        details: String(err),
      },
      500
    );
  }
}

async function handleRequest({ request, env }) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing OPENAI_API_KEY" },
      500
    );
  }

  // --- Parse body ---
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse(
      { error: "Invalid JSON body in request." },
      400
    );
  }

  const userPrompt =
    body && typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!userPrompt) {
    return jsonResponse(
      { error: "Invalid request: 'prompt' is required." },
      400
    );
  }

  const safePrompt = userPrompt.slice(0, 6000);

  // --- Call OpenAI ---
  let openAiRes;
  try {
    openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // change if your key uses a different model
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an expert travel planner for a drag-and-drop trip planner. " +
              "You MUST respond ONLY with valid JSON matching this schema:\n" +
              "{\n" +
              '  "suggestions": [\n' +
              "    {\n" +
              '      "id": "string-unique-id",\n' +
              '      "title": "short activity title",\n' +
              '      "timeOfDay": "morning" | "afternoon" | "evening" | "flex",\n' +
              "      \"dayHint\": number | null,\n" +
              '      "description": "1–3 sentence description",\n' +
              '      "notes": "optional quick notes for travelers"\n' +
              "    }\n" +
              "  ]\n" +
              "}\n" +
              "Do NOT include any other top-level keys. Do not wrap JSON in backticks or text.",
          },
          {
            role: "user",
            content: safePrompt,
          },
        ],
        temperature: 0.8,
        max_tokens: 900,
      }),
    });
  } catch (err) {
    return jsonResponse(
      {
        error: "Could not reach AI provider. Please try again shortly.",
        details: String(err),
      },
      502
    );
  }

  if (!openAiRes.ok) {
    const errorText = await openAiRes.text().catch(() => "");
    return jsonResponse(
      {
        error: "Upstream AI request failed.",
        upstreamStatus: openAiRes.status,
        upstreamBody: errorText,
      },
      502
    );
  }

  // --- Parse OpenAI JSON result ---
  let openAiData;
  try {
    openAiData = await openAiRes.json();
  } catch (err) {
    return jsonResponse(
      {
        error: "Failed to parse JSON from OpenAI response.",
        details: String(err),
      },
      502
    );
  }

  const message = openAiData?.choices?.[0]?.message;
  let parsed;

  // Some JSON modes may put the object directly in content, others as a string
  if (message?.parsed && typeof message.parsed === "object") {
    parsed = message.parsed;
  } else if (typeof message?.content === "string") {
    try {
      parsed = JSON.parse(message.content);
    } catch (err) {
      return jsonResponse(
        {
          error: "OpenAI returned invalid JSON (parse failed).",
          raw: message.content,
          details: String(err),
        },
        502
      );
    }
  } else if (typeof message?.content === "object") {
    parsed = message.content;
  } else {
    return jsonResponse(
      {
        error: "OpenAI response did not contain usable JSON content.",
      },
      502
    );
  }

  // --- Normalize suggestions ---
  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
    : [];

  if (!suggestions.length) {
    return jsonResponse(
      {
        error:
          "AI did not return any suggestions. Try adjusting trip details or length.",
      },
      502
    );
  }

  // Ensure each suggestion has a unique id
  const normalized = suggestions.map((s, idx) => {
    const id =
      typeof s.id === "string" && s.id.trim()
        ? s.id
        : `suggestion-${idx + 1}`;

    const timeOfDay =
      s.timeOfDay === "morning" ||
      s.timeOfDay === "afternoon" ||
      s.timeOfDay === "evening" ||
      s.timeOfDay === "flex"
        ? s.timeOfDay
        : "flex";

    return {
      id,
      title: s.title || "Activity",
      timeOfDay,
      dayHint:
        typeof s.dayHint === "number" && Number.isFinite(s.dayHint)
          ? s.dayHint
          : null,
      description: s.description || "",
      notes: s.notes || "",
    };
  });

  return jsonResponse({ suggestions: normalized }, 200);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
