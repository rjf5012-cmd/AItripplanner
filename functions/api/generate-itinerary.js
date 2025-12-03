// functions/api/generate-itinerary.js

export async function onRequest({ request }) {
  try {
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
  } catch (err) {
    console.error("[generate-itinerary] Dummy handler error:", err);
    return new Response(
      JSON.stringify({ error: String(err) || "Unknown error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
