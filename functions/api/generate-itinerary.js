// functions/api/generate-itinerary.js

export async function onRequest({ env }) {
  const apiKey = env && env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not set" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Call a simple endpoint: list models
  const res = await fetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + apiKey
    }
  });

  const text = await res.text();

  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "text/plain" }
  });
}
