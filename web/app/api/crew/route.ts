import { api, convexClient } from "@/lib/convex";

// Yatra keeps each ASI:One conversation's trip in Convex, so a restart loses nothing.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    chat?: string;
    fresh?: boolean;
    stage?: string;
    start?: string;
    end?: string;
    dates?: string;
    people?: string[] | null;
    near?: string;
  } | null;
  const chat = body?.chat?.trim();
  if (!chat) return Response.json({ error: "Need the chat address." }, { status: 400 });
  const client = convexClient();
  if (body?.action === "load") {
    return Response.json({ trip: await client.mutation(api.trips.loadCrew, { chat }) });
  }
  if (body?.action === "save" && body.stage) {
    const tripId = await client.mutation(api.trips.saveCrew, {
      chat,
      fresh: Boolean(body.fresh),
      stage: body.stage,
      start: body.start ?? "",
      end: body.end ?? "",
      dates: body.dates ?? "",
      people: Array.isArray(body.people) ? body.people.map(String).slice(0, 12) : null,
      near: body.near ?? "",
    });
    return Response.json({ tripId });
  }
  return Response.json({ error: "Use action load or save." }, { status: 400 });
}
