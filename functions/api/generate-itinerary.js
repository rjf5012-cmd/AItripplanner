// functions/api/generate-itinerary.js

export const onRequestPost = async ({ request, env }) => {
  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Server misconfiguration: missing OPENAI_API_KEY" },
        500
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
      return jsonResponse(
        { error: "Invalid request: 'prompt' is required." },
        400
      );
    }

    const prompt = body.prompt.trim().slice(0, 6000); // basic safety limit

    // Call OpenAI (chat completion style)
    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // or whichever model you prefer
        messages: [
          {
            role: "system",
            content:
              "You are an expert travel planner. Always give practical, realistic itineraries and avoid making up unsafe or impossible advice."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 1300
      })
    });

    if (!openAiRes.ok) {
      const errorText = await openAiRes.text().catch(() => "");
      console.error("OpenAI error:", openAiRes.status, errorText);
      return jsonResponse(
        { error: "Upstream AI request failed." },
        502
      );
    }

    const openAiData = await openAiRes.json();
    const itinerary =
      openAiData?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I couldn’t generate an itinerary. Please try again.";

    return jsonResponse({ itinerary }, 200);
  } catch (err) {
    console.error("Unexpected error in generate-itinerary:", err);
    return jsonResponse(
      { error: "Unexpected server error. Please try again." },
      500
    );
  }
};

/**
 * Helper to build JSON responses consistently
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
