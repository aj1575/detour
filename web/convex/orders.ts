import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orders")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .collect();
  },
});

export const add = mutation({
  args: {
    tripId: v.id("trips"),
    placeName: v.string(),
    member: v.string(),
    item: v.string(),
    price: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("orders", args);
  },
});

export const clearPlace = mutation({
  args: { tripId: v.id("trips"), placeName: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("orders")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .collect();
    await Promise.all(
      rows.filter((row) => row.placeName === args.placeName).map((row) => ctx.db.delete(row._id)),
    );
  },
});
