import { api, convexClient } from "@/lib/convex";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { lat?: number; lng?: number } | null;
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Need a latitude and longitude." }, { status: 400 });
  }
  const client = convexClient();
  const tripId = await client.mutation(api.trips.ensureDemo, {});
  await client.mutation(api.trips.setHere, { tripId, lat, lng });
  return Response.json({ ok: true });
}
