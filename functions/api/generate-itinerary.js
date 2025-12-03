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

  // Just echo back some fake suggestions so we can test the frontend
  const dummySuggestions = [
    {
      id: "s1",
      title: "Old Town Walking Tour",
      timeOfDay: "morning",
      dayHint: 1,
      description: "Explore the historic center with coffee and pastries along the way.",
      notes: "Wear comfy shoes."
    },
    {
      id: "s2",
      title: "Local Market + Street Food",
      timeOfDay: "afternoon",
      dayHint: 1,
      description: "Wander through the main market and sample local snacks.",
      notes: "Bring some small cash."
    },
    {
      id: "s3",
      title: "Sunset Viewpoint",
      timeOfDay: "evening",
      dayHint: 1,
      description: "Head to a popular lookout point to watch the sunset.",
      notes: "Great spot for photos."
    }
  ];

  return new Response(
    JSON.stringify({ suggestions: dummySuggestions }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
