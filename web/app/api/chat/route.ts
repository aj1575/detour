import { api, convexClient } from "@/lib/convex";
import { planWithDroid } from "@/lib/droid";
import { classify, defaultQuery, findPlaces, speakable } from "@/lib/monitor";
import { getCoastRoute } from "@/lib/route";
import type { Id } from "@/convex/_generated/dataModel";
import type { Plan } from "@/lib/monitor";

export async function POST(request: Request) {
  let tripId: Id<"trips">;
  let author = "";
  let text = "";
  try {
    const body = (await request.json()) as {
      tripId?: string;
      author?: string;
      text?: string;
    };
    if (!body.tripId || !body.author?.trim() || !body.text?.trim()) {
      return Response.json(
        { error: "Need a trip, an author, and a message." },
        { status: 400 },
      );
    }
    if (body.text.trim().length > 500) {
      return Response.json({ error: "Keep the message under 500 characters." }, { status: 400 });
    }
    tripId = body.tripId as Id<"trips">;
    author = body.author.trim();
    text = body.text.trim();
  } catch {
    return Response.json({ error: "The message could not be read." }, { status: 400 });
  }

  const client = convexClient();
  await client.mutation(api.messages.add, {
    tripId,
    author,
    role: "human",
    body: text,
    createdAt: Date.now(),
  });

  try {
    const coast = await getCoastRoute();
    const droid = await planWithDroid(text, coast.town);
    let plan: Plan;
    let note: string;
    if (droid.plan) {
      plan = droid.plan;
      note = droid.note;
    } else {
      plan = await classify(text, coast.town);
      note = `${droid.note} The message was classified from its words.`;
    }

    if (!defaultQuery(plan.intent, coast.town)) {
      await client.mutation(api.monitor.add, {
        tripId,
        intent: plan.intent,
        agent: "none",
        plan: plan.summary,
        status: "skipped",
        detail: `${note} No specialist was called.`,
        createdAt: Date.now(),
      });
      return Response.json({ ok: true });
    }

    await client.mutation(api.monitor.add, {
      tripId,
      intent: plan.intent,
      agent: plan.agent,
      plan: plan.summary,
      status: "running",
      detail: `Search: ${plan.query}. ${note}`,
      createdAt: Date.now(),
    });

    const found = await findPlaces(plan.query, coast);
    await client.mutation(api.messages.add, {
      tripId,
      author: plan.agent,
      role: "agent",
      body: speakable(plan.intent, found.places),
      placesJson: JSON.stringify(found.places),
      createdAt: Date.now(),
    });
    await client.mutation(api.monitor.add, {
      tripId,
      intent: plan.intent,
      agent: plan.agent,
      plan: plan.summary,
      status: "done",
      detail: `Posted ${found.places.length} places from ${found.source}.`,
      createdAt: Date.now(),
    });
    return Response.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The monitor failed.";
    await client.mutation(api.monitor.add, {
      tripId,
      intent: "error",
      agent: "none",
      plan: "The local monitor could not finish.",
      status: "error",
      detail,
      createdAt: Date.now(),
    });
    return Response.json({ error: detail }, { status: 502 });
  }
}
