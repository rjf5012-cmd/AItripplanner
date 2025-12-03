import OpenAI from "openai";

export async function onRequestPost({ request, env }) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  let prompt = "Plan a short 2-day city trip.";
  try {
    const body = await request.json();
    if (body.prompt) prompt = body.prompt;
  } catch (_) {}

  const client = new OpenAI({ apiKey });

  try {
    const result = await client.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
      response_format: { type: "json_object" }
    });

    const text = result.output_text;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return Response.json(
        { error: "Bad JSON from AI", raw: text, details: err.message },
        { status: 502 }
      );
    }

    return Response.json(parsed, { status: 200 });
  } catch (err) {
    return Response.json(
      { error: "OpenAI request failed", details: err.message },
      { status: 502 }
    );
  }
}
