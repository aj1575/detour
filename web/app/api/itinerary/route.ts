import { api, convexClient } from "@/lib/convex";
import { buildItinerary } from "@/lib/itinerary";
import type { Id } from "@/convex/_generated/dataModel";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tripId?: string; text?: string } | null;
  const client = convexClient();
  const tripId = (body?.tripId as Id<"trips"> | undefined) ?? (await client.mutation(api.trips.ensureDemo, {}));
  const trip = await client.query(api.trips.get, { tripId });
  if (!trip?.destination) {
    return Response.json(
      { error: "Tell Atlas where you're headed first, for example: San Jose to Big Sur." },
      { status: 400 },
    );
  }
  const board = await client.query(api.options.board, { tripId });
  const text = body?.text?.trim().slice(0, 300) || "Plan our trip.";
  try {
    const plan = await buildItinerary(
      {
        origin: trip.origin,
        destination: trip.destination,
        dates: trip.dates ?? "",
        people: trip.people ?? [],
        stays: board.stays.map((item) => ({ name: item.name, votes: item.votes })),
        activities: board.activities.map((item) => ({ name: item.name, votes: item.votes })),
      },
      text,
    );
    await client.mutation(api.trips.setItinerary, { tripId, days: plan.days, source: plan.source });
    await client.mutation(api.messages.add, {
      tripId,
      author: "Planner",
      role: "agent",
      body: `${plan.summary} ${plan.days.map((day) => `${day.title}: ${day.stops.map((stop) => `${stop.time} ${stop.place}`).join(", ")}.`).join(" ")}`,
      createdAt: Date.now(),
    });
    await client.mutation(api.monitor.add, {
      tripId,
      intent: "itinerary",
      agent: "Planner",
      plan: "Build a day-by-day plan from real places and the group's votes.",
      status: "done",
      detail: `${plan.days.length} days. ${plan.source}.`,
      createdAt: Date.now(),
    });
    return Response.json({ ...plan, trip: { origin: trip.origin, destination: trip.destination, dates: trip.dates ?? "" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The plan could not be built.";
    return Response.json({ error: detail }, { status: 502 });
  }
}
