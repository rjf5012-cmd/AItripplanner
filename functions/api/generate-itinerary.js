// functions/api/generate-itinerary.js

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;

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

  // Read prompt from body (with a fallback)
  let prompt = "Plan a 1-day highlight trip for a popular city.";
  try {
    const bodyText = await request.text();
    if (bodyText) {
      const data = JSON.parse(bodyText);
      if (data && typeof data.prompt === "string") {
        prompt = data.prompt.trim();
      }
    }
  } catch (e) {
    // if JSON parse fails, keep the default prompt
  }

  // Build OpenAI payload
  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are an expert travel planner. " +
          "Reply ONLY with JSON in this format: " +
          '{ "suggestions": [ { "id": "id1", "title": "short title", "timeOfDay": "morning|afternoon|evening|flex", "dayHint": 1, "description": "1–3 sentences", "notes": "optional notes" } ] }'
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.8,
    max_tokens: 900
  };

  // Call OpenAI
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();

  // Just return OpenAI’s raw response for now
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" }
  });
}
