import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { kind } from "./schema";
import { limits } from "./limits";

const option = v.object({
  name: v.string(),
  detail: v.string(),
  rating: v.string(),
  miles: v.optional(v.number()),
});

export const save = mutation({
  args: { tripId: v.id("trips"), kind, options: v.array(option) },
  handler: async (ctx, args) => {
    for (const item of args.options) {
      const existing = await ctx.db
        .query("options")
        .withIndex("by_name", (q) => q.eq("tripId", args.tripId).eq("kind", args.kind).eq("name", item.name))
        .first();
      if (existing) await ctx.db.patch(existing._id, { ...item, createdAt: Date.now() });
      else await ctx.db.insert("options", { ...item, tripId: args.tripId, kind: args.kind, createdAt: Date.now() });
    }
  },
});

async function tally(ctx: QueryCtx, tripId: Id<"trips">, which: "stay" | "activity") {
  const options = await ctx.db
    .query("options")
    .withIndex("by_trip", (q) => q.eq("tripId", tripId).eq("kind", which))
    .collect();
  const votes = await ctx.db
    .query("votes")
    .withIndex("by_trip", (q) => q.eq("tripId", tripId).eq("kind", which))
    .collect();
  return options
    .map((item) => {
      const mine = votes.filter((vote) => vote.optionId === item._id);
      return { ...item, votes: mine.length, voters: mine.map((vote) => vote.voter) };
    })
    .sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
}

// Live on the trip board: every option with its vote count.
export const board = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, { tripId }) => ({
    stays: await tally(ctx, tripId, "stay"),
    activities: await tally(ctx, tripId, "activity"),
  }),
});

// One vote per person per kind. Voting again moves the vote.
export const vote = mutation({
  args: { tripId: v.id("trips"), kind, name: v.string(), voter: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("options")
      .withIndex("by_name", (q) => q.eq("tripId", args.tripId).eq("kind", args.kind).eq("name", args.name))
      .first();
    if (!item) return { ok: false as const, error: `${args.name} is not on this trip's list.` };
    const { ok } = await limits.limit(ctx, "vote", { key: `${args.tripId}:${args.voter}` });
    if (!ok) return { ok: false as const, error: "That's a lot of votes at once. Try again in a few seconds." };
    const previous = await ctx.db
      .query("votes")
      .withIndex("by_voter", (q) => q.eq("tripId", args.tripId).eq("kind", args.kind).eq("voter", args.voter))
      .first();
    if (previous) await ctx.db.delete(previous._id);
    await ctx.db.insert("votes", {
      tripId: args.tripId,
      kind: args.kind,
      optionId: item._id,
      voter: args.voter,
      createdAt: Date.now(),
    });
    const ranked = await tally(ctx, args.tripId, args.kind);
    return {
      ok: true as const,
      moved: Boolean(previous && previous.optionId !== item._id),
      tally: ranked.filter((row) => row.votes > 0).map((row) => ({ name: row.name, votes: row.votes })),
    };
  },
});
