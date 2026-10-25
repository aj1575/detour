import { api, convexClient } from "@/lib/convex";
import { measurePhoto } from "@/lib/photos";
import type { Id } from "@/convex/_generated/dataModel";

const MAX_BYTES = 15 * 1024 * 1024;

// A photo shared in ASI:One (sent by Atlas as base64) or uploaded on the board (a form file).
export async function POST(request: Request) {
  let bytes: Buffer;
  let sharedBy = "Someone";
  let tripId: string | undefined;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("photo");
      if (!(file instanceof File)) return Response.json({ error: "Attach a photo." }, { status: 400 });
      bytes = Buffer.from(await file.arrayBuffer());
      sharedBy = String(form.get("sharedBy") || sharedBy);
      tripId = String(form.get("tripId") || "") || undefined;
    } else {
      const body = (await request.json()) as { data?: string; sharedBy?: string; tripId?: string };
      if (!body.data) return Response.json({ error: "Send the photo as base64 in data." }, { status: 400 });
      bytes = Buffer.from(body.data.replace(/^data:[^,]+,/, ""), "base64");
      sharedBy = body.sharedBy?.trim() || sharedBy;
      tripId = body.tripId;
    }
  } catch {
    return Response.json({ error: "The photo could not be read." }, { status: 400 });
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return Response.json({ error: "Photos must be under 15 MB." }, { status: 413 });
  }

  const client = convexClient();
  const trip = (tripId as Id<"trips"> | undefined) ?? (await client.mutation(api.trips.ensureDemo, {}));
  let measured;
  try {
    measured = await measurePhoto(bytes);
  } catch {
    return Response.json({ error: "That file is not a photo we can open." }, { status: 415 });
  }
  const uploadUrl = await client.mutation(api.photos.uploadUrl, {});
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: new Uint8Array(measured.image),
  });
  if (!upload.ok) return Response.json({ error: "Convex storage did not accept the photo." }, { status: 502 });
  const { storageId } = (await upload.json()) as { storageId: Id<"_storage"> };
  let saved;
  try {
    saved = await client.mutation(api.photos.add, {
      tripId: trip,
      storageId,
      sharedBy: sharedBy.slice(0, 80),
      width: measured.width,
      height: measured.height,
      look: measured.look,
    });
  } catch {
    return Response.json({ error: "Too many photos at once. Try again in a minute." }, { status: 429 });
  }
  return Response.json({ ...saved, look: measured.look });
}
