import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const ensureDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("trips").first();
    if (existing) {
      const first = await ctx.db
        .query("messages")
        .withIndex("by_trip", (q) => q.eq("tripId", existing._id))
        .first();
      if (first?.body.includes("until a Factory key is added")) {
        await ctx.db.patch(first._id, {
          body: "Local companion for Alex, the trip lead, and Jordan, the driver. Droid reads each message and calls one specialist. The Fetch channel is not connected yet.",
        });
      }
      return existing._id;
    }
    const tripId = await ctx.db.insert("trips", {
      name: "SF to Big Sur",
      origin: "San Francisco",
      destination: "Big Sur",
      positionLabel: "Half Moon Bay, Highway 1",
      leadName: "Alex",
      driverName: "Jordan",
    });
    await ctx.db.insert("messages", {
      tripId,
      author: "Detour",
      role: "system",
      body: "Local companion for Alex, the trip lead, and Jordan, the driver. Droid reads each message and calls one specialist. The Fetch channel is not connected yet.",
      createdAt: Date.now(),
    });
    return tripId;
  },
});

export const get = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tripId);
  },
});
