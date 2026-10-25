import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("monitorLogs")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .collect();
    return rows.reverse();
  },
});

export const add = mutation({
  args: {
    tripId: v.id("trips"),
    intent: v.string(),
    agent: v.string(),
    plan: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("skipped"),
      v.literal("error"),
    ),
    detail: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("monitorLogs", args);
  },
});
