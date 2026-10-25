import { api, convexClient } from "@/lib/convex";
import { defaultQuery, findPlaces, speakable, type Intent } from "@/lib/monitor";
import { getCoastRoute } from "@/lib/route";
import type { Id } from "@/convex/_generated/dataModel";

const INTENTS: Record<string, Intent> = {
  "Personal Chef": "breakfast",
  "Pit Stop": "gas",
  Lifeline: "medical",
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: string;
    author?: string;
    agent?: string;
    text?: string;
  } | null;
  const intent = body?.agent ? INTENTS[body.agent] : undefined;
  if (!body?.tripId || !body.agent || !intent || !body.text?.trim()) {
    return Response.json({ error: "Need a trip, a specialist, and a message." }, { status: 400 });
  }
  const tripId = body.tripId as Id<"trips">;
  const author = body.author?.trim() || "Alex";
  const text = body.text.trim().slice(0, 500);
  const client = convexClient();
  try {
    const coast = await getCoastRoute();
    const query = defaultQuery(intent, coast.town);
    await client.mutation(api.messages.add, {
      tripId,
      author,
      role: "human",
      body: text,
      createdAt: Date.now(),
    });
    const found = await findPlaces(query, coast);
    const spoken = speakable(intent, found.places);
    await client.mutation(api.messages.add, {
      tripId,
      author: body.agent,
      role: "agent",
      body: spoken,
      placesJson: JSON.stringify(found.places),
      createdAt: Date.now(),
    });
    await client.mutation(api.monitor.add, {
      tripId,
      intent,
      agent: body.agent,
      plan: `${body.agent} handled this message.`,
      status: "done",
      detail: `Posted ${found.places.length} places from ${found.source}.`,
      createdAt: Date.now(),
    });
    return Response.json({ reply: spoken, places: found.places });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The specialist failed.";
    return Response.json({ error: detail }, { status: 502 });
  }
}
