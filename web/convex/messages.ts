import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .collect();
  },
});

export const add = mutation({
  args: {
    tripId: v.id("trips"),
    author: v.string(),
    role: v.union(v.literal("human"), v.literal("agent"), v.literal("system")),
    body: v.string(),
    placesJson: v.optional(v.string()),
    menuJson: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", args);
  },
});
