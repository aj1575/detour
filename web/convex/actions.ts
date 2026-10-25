import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const registerAgent = mutation({
  args: {
    name: v.string(),
    handle: v.string(),
    address: v.string(),
    role: v.string(),
    protocols: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .first();
    if (existing) await ctx.db.patch(existing._id, { ...args, startedAt: Date.now() });
    else await ctx.db.insert("agents", { ...args, startedAt: Date.now() });
  },
});

// Returns the earlier action when this key was already handled, and counts the repeat it blocked.
export const claim = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const earlier = await ctx.db
      .query("actions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!earlier) return null;
    await ctx.db.patch(earlier._id, { repeats: earlier.repeats + 1 });
    return earlier;
  },
});

export const record = mutation({
  args: {
    key: v.string(),
    agent: v.string(),
    address: v.string(),
    kind: v.string(),
    text: v.string(),
    result: v.string(),
    status: v.union(v.literal("done"), v.literal("error")),
    at: v.number(),
    digest: v.string(),
    signature: v.string(),
    ms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const earlier = await ctx.db
      .query("actions")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (earlier) return earlier._id;
    return await ctx.db.insert("actions", { ...args, repeats: 0 });
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db.query("actions").withIndex("by_at").order("desc").take(Math.min(limit ?? 40, 200));
  },
});

// One ID card per agent: who it is, and what it has done.
export const passports = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    return await Promise.all(
      agents.map(async (agent) => {
        const done = await ctx.db
          .query("actions")
          .withIndex("by_address", (q) => q.eq("address", agent.address))
          .order("desc")
          .collect();
        return {
          ...agent,
          actions: done.length,
          errors: done.filter((action) => action.status === "error").length,
          repeatsBlocked: done.reduce((sum, action) => sum + action.repeats, 0),
          medianMs: median(done.map((action) => action.ms).filter((ms): ms is number => typeof ms === "number")),
          last: done[0] ? { kind: done[0].kind, text: done[0].text, at: done[0].at, signature: done[0].signature } : null,
        };
      }),
    );
  },
});

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
