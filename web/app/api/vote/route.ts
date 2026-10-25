import { api, convexClient } from "@/lib/convex";
import type { Id } from "@/convex/_generated/dataModel";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: string;
    kind?: string;
    name?: string;
    voter?: string;
  } | null;
  const kind = body?.kind === "stay" || body?.kind === "activity" ? body.kind : null;
  const name = body?.name?.trim();
  const voter = body?.voter?.trim();
  if (!kind || !name || !voter) {
    return Response.json({ error: "Need a kind (stay or activity), an option, and a voter." }, { status: 400 });
  }
  const client = convexClient();
  const tripId = (body?.tripId as Id<"trips"> | undefined) ?? (await client.mutation(api.trips.ensureDemo, {}));
  const result = await client.mutation(api.options.vote, { tripId, kind, name, voter });
  if (!result.ok) return Response.json({ error: result.error }, { status: 404 });
  return Response.json(result);
}
