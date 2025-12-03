// functions/api/generate-itinerary.js

export async function onRequest(context) {
  try {
    const { request, env } = context;

    if (!env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "OPENAI_API_KEY missing in env"
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Call OpenAI /models as a simple connectivity test
    const upstream = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + env.OPENAI_API_KEY
      }
    });

    const text = await upstream.text();

    return new Response(
      JSON.stringify({
        ok: true,
        method: request.method,
        path: new URL(request.url).pathname,
        openaiStatus: upstream.status,
        // just a small slice so response isn't huge
        openaiBodySample: text.slice(0, 600)
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Exception in function",
        details: String(err)
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
