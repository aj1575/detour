import { api, convexClient } from "@/lib/convex";
import { getCoastRoute } from "@/lib/route";

export async function GET() {
  const client = convexClient();
  const tripId = await client.mutation(api.trips.ensureDemo, {});
  const trip = await client.query(api.trips.get, { tripId });
  const messages = await client.query(api.messages.list, { tripId });
  const logs = await client.query(api.monitor.list, { tripId });
  const orders = await client.query(api.orders.list, { tripId });
  const route = await getCoastRoute();
  return Response.json({
    tripId,
    trip,
    messages,
    logs,
    orders,
    route: { summary: route.summary, town: route.town },
  });
}
