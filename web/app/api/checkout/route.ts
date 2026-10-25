import { api, convexClient } from "@/lib/convex";
import { createEmbeddedCheckout } from "@/lib/commerce";
import type { Id } from "@/convex/_generated/dataModel";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: string;
    placeName?: string;
  } | null;
  if (!body?.tripId || !body.placeName?.trim()) {
    return Response.json({ error: "Need a trip and a place." }, { status: 400 });
  }
  const tripId = body.tripId as Id<"trips">;
  const placeName = body.placeName.trim();
  const client = convexClient();
  const orders = (await client.query(api.orders.list, { tripId })).filter(
    (order) => order.placeName === placeName,
  );
  if (orders.length === 0) {
    return Response.json({ error: "Add at least one item before paying." }, { status: 400 });
  }
  const cents = orders.reduce((sum, order) => sum + Math.round(order.price * 100), 0);
  if (cents < 50) return Response.json({ error: "The test total is below $0.50." }, { status: 400 });
  const description = `Travel Assist AI demo order at ${placeName}`;
  try {
    const checkout = await createEmbeddedCheckout(
      cents,
      description,
      `detour-checkout-${tripId}-${placeName}-${cents}-${Date.now()}`,
    );
    return Response.json({
      ok: true,
      placeName,
      description,
      dollars: (cents / 100).toFixed(2),
      ...checkout,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Stripe checkout did not open.";
    return Response.json({ error: detail }, { status: 502 });
  }
}
