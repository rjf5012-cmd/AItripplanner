// functions/api/generate-itinerary.js

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (err) {
    return jsonResponse(
      {
        error: "Worker crashed BEFORE sending a response.",
        details: String(err),
        stack: err?.stack || null
      },
      500
    );
  }
}

async function handleRequest({ request, env }) {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Missing OPENAI_API_KEY (env var not set)" },
        500
      );
    }

    // Parse request JSON
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse(
        { error: "Invalid JSON body", details: String(err) },
        400
      );
    }

    const userPrompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!userPrompt) {
      return jsonResponse(
        { error: "Missing 'prompt' field in JSON body" },
        400
      );
    }

    const safePrompt = userPrompt.slice(0, 6000);

    // Call OpenAI API
    let openAiRes;
    try {
      openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // <-- may be your issue
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Return ONLY JSON with trip suggestions."
            },
            {
              role: "user",
              content: safePrompt
            }
          ],
        }),
      });
    } catch (err) {
      return jsonResponse(
        {
          error: "Network error calling OpenAI",
          details: String(err),
        },
        502
      );
    }

    // Handle non-OK responses
    if (!openAiRes.ok) {
      const errorText = await openAiRes.text().catch(() => "");
      return jsonResponse(
        {
          error: "OpenAI returned an error",
          upstreamStatus: openAiRes.status,
          upstreamBody: errorText,
        },
        502
      );
    }

    // Try to parse JSON from OpenAI
    const openAiData = await openAiRes.json().catch((err) => {
      return jsonResponse(
        {
          error: "Failed to parse JSON from OpenAI",
          details: String(err),
        },
        502
      );
    });

    const raw = openAiData?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return jsonResponse(
        {
          error: "OpenAI returned invalid JSON (parse failed)",
          raw,
          details: String(err),
        },
        502
      );
    }

    return jsonResponse(parsed, 200);
  } catch (err) {
    return jsonResponse(
      { error: "Unexpected error", details: String(err) },
      500
    );
  }
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
