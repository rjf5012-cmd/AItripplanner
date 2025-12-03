// functions/api/generate-itinerary.js

export async function onRequest(context) {
  const { request, env } = context;

  return new Response(
    JSON.stringify({
      ok: true,
      method: request.method,
      path: new URL(request.url).pathname,
      hasOpenAIKey: !!(env && env.OPENAI_API_KEY),
      note: "This is the minimal health-check function, no OpenAI call yet."
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
