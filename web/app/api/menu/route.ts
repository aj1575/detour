import { api, convexClient } from "@/lib/convex";
import { buildMenu } from "@/lib/commerce";
import type { Id } from "@/convex/_generated/dataModel";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tripId?: string; placeName?: string } | null;
  if (!body?.tripId || !body.placeName?.trim()) {
    return Response.json({ error: "Need a trip and a place." }, { status: 400 });
  }
  const placeName = body.placeName.trim().slice(0, 120);
  const menu = await buildMenu(placeName);
  const client = convexClient();
  await client.mutation(api.messages.add, {
    tripId: body.tripId as Id<"trips">,
    author: "Waiter",
    role: "agent",
    body: `${menu.note} ${placeName}: ${menu.dishes.map((dish) => `${dish.name} $${dish.price.toFixed(2)}`).join(", ")}.`,
    menuJson: JSON.stringify({ placeName, dishes: menu.dishes, note: menu.note }),
    createdAt: Date.now(),
  });
  return Response.json({ ok: true, placeName, ...menu });
}
