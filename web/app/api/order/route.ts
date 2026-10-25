import { api, convexClient } from "@/lib/convex";
import type { Id } from "@/convex/_generated/dataModel";
import type { Dish } from "@/lib/commerce";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: string;
    placeName?: string;
    member?: string;
    item?: string;
    action?: string;
  } | null;
  if (!body?.tripId || !body.placeName?.trim()) {
    return Response.json({ error: "Need a trip and a place." }, { status: 400 });
  }
  const tripId = body.tripId as Id<"trips">;
  const placeName = body.placeName.trim();
  const client = convexClient();

  if (body.action === "clear") {
    await client.mutation(api.orders.clearPlace, { tripId, placeName });
    return Response.json({ ok: true });
  }

  // Atlas names each diner from the ASI:One group chat, so any short name is accepted.
  const member = body.member?.trim().slice(0, 40) ?? "";
  const item = body.item?.trim() ?? "";
  if (!member || !item) {
    return Response.json({ error: "Choose who is ordering and a menu item." }, { status: 400 });
  }

  const messages = await client.query(api.messages.list, { tripId });
  const menu = [...messages].reverse().find((message) => {
    if (!message.menuJson) return false;
    try {
      return (JSON.parse(message.menuJson) as { placeName?: string }).placeName === placeName;
    } catch {
      return false;
    }
  });
  if (!menu?.menuJson) {
    return Response.json({ error: "Open the menu before adding an item." }, { status: 400 });
  }
  const dishes = (JSON.parse(menu.menuJson) as { dishes?: Dish[] }).dishes ?? [];
  const dish = dishes.find((entry) => entry.name === item);
  if (!dish) return Response.json({ error: "That item is not on the sample menu." }, { status: 400 });

  await client.mutation(api.orders.add, {
    tripId,
    placeName,
    member,
    item: dish.name,
    price: dish.price,
    createdAt: Date.now(),
  });
  await client.mutation(api.messages.add, {
    tripId,
    author: member,
    role: "system",
    body: `${member} added ${dish.name} ($${dish.price.toFixed(2)}) at ${placeName}.`,
    createdAt: Date.now(),
  });
  return Response.json({ ok: true });
}
