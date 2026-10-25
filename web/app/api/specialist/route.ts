import { api, convexClient } from "@/lib/convex";
import {
  defaultQuery,
  findPlaces,
  geocode,
  nearbyQuery,
  speakable,
  type Intent,
  type Origin,
} from "@/lib/monitor";
import { getCoastRoute } from "@/lib/route";
import type { Id } from "@/convex/_generated/dataModel";

const INTENTS: Record<string, Intent> = {
  "Personal Chef": "breakfast",
  "Pit Stop": "gas",
  Lifeline: "medical",
  Stays: "stay",
  Guide: "activity",
};

// Stays and things to do are searched around the destination and ranked by relevance, not distance.
const AROUND_DESTINATION = new Set<Intent>(["stay", "activity"]);

const FRESH_MS = 6 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: string;
    author?: string;
    agent?: string;
    text?: string;
    near?: string;
    home?: string;
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
    const trip = await client.query(api.trips.get, { tripId });
    let origin: Origin | null = null;
    const named = await geocode(body.near ?? "");
    if (named) {
      origin = {
        lat: named.lat,
        lng: named.lng,
        town: named.label,
        nearby: true,
        byRelevance: AROUND_DESTINATION.has(intent),
      };
    } else if (trip?.hereLat !== undefined && trip.hereLng !== undefined && Date.now() - (trip.hereAt ?? 0) < FRESH_MS) {
      origin = { lat: trip.hereLat, lng: trip.hereLng, town: "your shared location", nearby: true };
    } else {
      const home = await geocode(body.home ?? "");
      if (home) origin = { lat: home.lat, lng: home.lng, town: home.label, nearby: true };
    }
    const coast = origin ? null : await getCoastRoute();
    const query = origin ? nearbyQuery(intent, text) : defaultQuery(intent, coast!.town);

    await client.mutation(api.messages.add, {
      tripId,
      author,
      role: "human",
      body: text,
      createdAt: Date.now(),
    });
    const found = await findPlaces(query, origin ?? coast!);
    const hint = origin
      ? ""
      : ` I searched near ${coast!.town} on the demo route. For places near you, open ${new URL(request.url).origin}/here to share your location, or tell me where you are.`;
    const spoken = speakable(intent, found.places, origin?.town) + hint;
    await client.mutation(api.messages.add, {
      tripId,
      author: body.agent,
      role: "agent",
      body: spoken,
      placesJson: JSON.stringify(found.places),
      createdAt: Date.now(),
    });
    if (intent === "stay" || intent === "activity") {
      await client.mutation(api.options.save, {
        tripId,
        kind: intent,
        options: found.places.map((place) => ({
          name: place.name,
          detail: place.detail,
          rating: place.rating,
          ...(typeof place.miles === "number" ? { miles: place.miles } : {}),
        })),
      });
    }
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
