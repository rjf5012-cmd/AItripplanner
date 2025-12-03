// functions/api/generate-itinerary.js

export async function onRequest({ request }) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed (POST only)" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const body = await request.json().catch(() => null);

  return new Response(
    JSON.stringify({
      ok: true,
      message: "Function is reachable and working.",
      received: body,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
