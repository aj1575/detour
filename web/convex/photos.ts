import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { limits } from "./limits";

const look = v.object({
  hue: v.number(),
  saturation: v.number(),
  brightness: v.number(),
  warmth: v.number(),
  contrast: v.number(),
  sharpness: v.number(),
  colorfulness: v.number(),
  hues: v.array(v.number()),
  palette: v.array(v.string()),
  theme: v.string(),
  score: v.number(),
});

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const add = mutation({
  args: {
    tripId: v.id("trips"),
    storageId: v.id("_storage"),
    sharedBy: v.string(),
    width: v.number(),
    height: v.number(),
    look,
  },
  handler: async (ctx, args) => {
    await limits.limit(ctx, "photo", { key: args.tripId, throws: true });
    const photoId = await ctx.db.insert("photos", { ...args, createdAt: Date.now() });
    const count = (
      await ctx.db
        .query("photos")
        .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
        .collect()
    ).length;
    return { photoId, count, url: await ctx.storage.getUrl(args.storageId) };
  },
});

async function withUrl(ctx: QueryCtx, photo: Doc<"photos">) {
  return { ...photo, url: (await ctx.storage.getUrl(photo.storageId)) ?? "" };
}

// The trip album, newest first, each photo with a public URL.
export const album = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }) => {
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .order("desc")
      .collect();
    return await Promise.all(photos.map((photo) => withUrl(ctx, photo)));
  },
});

export const savePost = mutation({
  args: {
    tripId: v.id("trips"),
    photoIds: v.array(v.id("photos")),
    theme: v.string(),
    caption: v.string(),
    hashtags: v.array(v.string()),
    source: v.string(),
  },
  handler: async (ctx, args) => await ctx.db.insert("posts", { ...args, createdAt: Date.now() }),
});

// Curated posts, newest first, with their photos resolved.
export const posts = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_trip", (q) => q.eq("tripId", tripId))
      .order("desc")
      .take(5);
    return await Promise.all(
      posts.map(async (post) => ({
        ...post,
        photos: (
          await Promise.all(
            post.photoIds.map(async (id: Id<"photos">) => {
              const photo = await ctx.db.get(id);
              return photo ? await withUrl(ctx, photo) : null;
            }),
          )
        ).filter((photo) => photo !== null),
      })),
    );
  },
});
