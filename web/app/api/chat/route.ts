import { api, convexClient } from "@/lib/convex";
import { planWithDroid } from "@/lib/droid";
import { classify } from "@/lib/monitor";
import { getCoastRoute } from "@/lib/route";
import type { Id } from "@/convex/_generated/dataModel";
import type { Plan } from "@/lib/monitor";

// The board's message box and voice search. Droid picks the specialist, then the same routes the
// ASI:One agents use do the work, so a spoken request on the board reaches the whole concierge.
const SEARCHERS = new Set(["Personal Chef", "Pit Stop", "Lifeline", "Stays", "Guide"]);
const AT_DESTINATION = new Set(["Stays", "Guide"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tripId?: string; author?: string; text?: string } | null;
  const text = body?.text?.trim() ?? "";
  const author = body?.author?.trim() || "Guest";
  if (!body?.tripId || !text) {
    return Response.json({ error: "Need a trip and a message." }, { status: 400 });
  }
  if (text.length > 500) {
    return Response.json({ error: "Keep the message under 500 characters." }, { status: 400 });
  }
  const tripId = body.tripId as Id<"trips">;
  const client = convexClient();
  const trip = await client.query(api.trips.get, { tripId });

  let plan: Plan;
  let note: string;
  try {
    const coast = await getCoastRoute();
    const droid = await planWithDroid(text, trip?.destination || coast.town);
    plan = droid.plan ?? classify(text, coast.town);
    note = droid.plan ? droid.note : `${droid.note} The message was classified from its words.`;
  } catch (error) {
    plan = classify(text);
    note = error instanceof Error ? error.message : "Droid could not read the message.";
  }
  await client.mutation(api.monitor.add, {
    tripId,
    intent: plan.intent,
    agent: plan.agent,
    plan: plan.summary,
    status: plan.agent === "none" || plan.agent === "Trip" ? "skipped" : "running",
    detail: `From the board. ${note}`,
    createdAt: Date.now(),
  });

  const origin = new URL(request.url).origin;
  const call = async (path: string, payload: object) => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; reply?: string };
    if (!response.ok) throw new Error(result.error || `${path} returned ${response.status}.`);
    return result;
  };

  try {
    if (SEARCHERS.has(plan.agent)) {
      const near = plan.near || (AT_DESTINATION.has(plan.agent) ? trip?.destination ?? "" : trip?.near ?? "");
      const result = await call("/api/specialist", {
        tripId,
        author,
        agent: plan.agent,
        text,
        near,
        home: trip?.origin ?? "",
      });
      return Response.json({ ok: true, agent: plan.agent, reply: result.reply });
    }
    await client.mutation(api.messages.add, { tripId, author, role: "human", body: text, createdAt: Date.now() });
    if (plan.agent === "Planner") {
      await call("/api/itinerary", { tripId, text });
      return Response.json({ ok: true, agent: plan.agent });
    }
    if (plan.agent === "Curator") {
      await call("/api/curate", { tripId, text });
      return Response.json({ ok: true, agent: plan.agent });
    }
    const hint =
      plan.agent === "none"
        ? "Ask for a place to stay, things to do, a day-by-day plan, food, gas, or urgent care."
        : "Menus, payments, and the trip setup happen in the ASI:One chat with Yatra. Use the order desk on this board for the group order.";
    await client.mutation(api.messages.add, {
      tripId,
      author: "Yatra",
      role: "agent",
      body: hint,
      createdAt: Date.now(),
    });
    return Response.json({ ok: true, agent: plan.agent, reply: hint });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The request failed.";
    await client.mutation(api.monitor.add, {
      tripId,
      intent: plan.intent,
      agent: plan.agent,
      plan: plan.summary,
      status: "error",
      detail,
      createdAt: Date.now(),
    });
    return Response.json({ error: detail }, { status: 502 });
  }
}
