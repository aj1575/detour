import { api, convexClient } from "@/lib/convex";
import { curate, writeCaption } from "@/lib/photos";
import type { Id } from "@/convex/_generated/dataModel";

// The Curator: picks the photos that look best together and writes a caption for the post.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tripId?: string; text?: string } | null;
  const client = convexClient();
  const tripId = (body?.tripId as Id<"trips"> | undefined) ?? (await client.mutation(api.trips.ensureDemo, {}));
  const [trip, album, earlier] = await Promise.all([
    client.query(api.trips.get, { tripId }),
    client.query(api.photos.album, { tripId }),
    client.query(api.photos.posts, { tripId }),
  ]);
  if (album.length === 0) {
    return Response.json(
      { error: "No photos yet. Share trip photos with Atlas in the chat, or upload them on the trip board." },
      { status: 404 },
    );
  }
  // Asking again gives a different set than the last post.
  const avoid = earlier.map((post) => post.photoIds.map(String).sort().join(","));
  const picked = curate(
    album.map((photo) => ({ _id: photo._id, url: photo.url, look: photo.look, createdAt: photo.createdAt })),
    avoid,
  );
  if (!picked) return Response.json({ error: "No set of photos could be chosen." }, { status: 404 });

  const stops = (trip?.itinerary ?? []).flatMap((day) => day.stops.map((stop) => stop.place))
    .filter((place) => !/^Drive from/i.test(place));
  const caption = await writeCaption(
    {
      origin: trip?.origin ?? "",
      destination: trip?.destination ?? "",
      dates: trip?.dates ?? "",
      people: trip?.people ?? [],
      stops: [...new Set(stops)],
    },
    picked.theme,
    picked.palette,
    picked.photos.length,
    body?.text?.trim().slice(0, 200) || "Curate a post from our trip photos.",
  );
  await client.mutation(api.photos.savePost, {
    tripId,
    photoIds: picked.photos.map((photo) => photo._id as Id<"photos">),
    theme: picked.theme,
    caption: caption.caption,
    hashtags: caption.hashtags,
    source: caption.source,
  });
  await client.mutation(api.messages.add, {
    tripId,
    author: "Curator",
    role: "agent",
    body: `Post ready: ${picked.photos.length} of ${album.length} photos with a ${picked.theme} look. ${caption.caption} ${caption.hashtags.join(" ")}`,
    createdAt: Date.now(),
  });
  await client.mutation(api.monitor.add, {
    tripId,
    intent: "post",
    agent: "Curator",
    plan: "Pick the photos that look best together and caption them.",
    status: "done",
    detail: `${picked.photos.length} of ${album.length} photos, theme ${picked.theme}, spread ${picked.cohesion}. ${caption.source}.`,
    createdAt: Date.now(),
  });
  return Response.json({
    theme: picked.theme,
    palette: picked.palette,
    photos: picked.photos.map((photo) => ({ url: photo.url, theme: photo.look.theme, score: photo.look.score })),
    total: album.length,
    ...caption,
  });
}
