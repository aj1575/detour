import { api, convexClient } from "@/lib/convex";
import { planWithDroid } from "@/lib/droid";
import { classify } from "@/lib/monitor";
import { getCoastRoute } from "@/lib/route";
import type { Id } from "@/convex/_generated/dataModel";
import type { Plan } from "@/lib/monitor";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tripId?: string; text?: string } | null;
  if (!body?.tripId || !body.text?.trim()) {
    return Response.json({ error: "Need a trip and a message." }, { status: 400 });
  }
  const text = body.text.trim().slice(0, 500);
  const tripId = body.tripId as Id<"trips">;
  const client = convexClient();
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
    await client.mutation(api.monitor.add, {
      tripId,
      intent: plan.intent,
      agent: plan.agent,
      plan: plan.summary,
      status: plan.intent === "chitchat" ? "skipped" : "running",
      detail: note,
      createdAt: Date.now(),
    });
    return Response.json({
      agent: plan.agent,
      intent: plan.intent,
      summary: plan.summary,
      near: plan.near ?? "",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Droid could not read the message.";
    return Response.json({ error: detail }, { status: 502 });
  }
}
