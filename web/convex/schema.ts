import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const stop = v.object({ time: v.string(), place: v.string(), note: v.string() });
export const day = v.object({ title: v.string(), stops: v.array(stop) });
export const kind = v.union(v.literal("stay"), v.literal("activity"));

export default defineSchema({
  trips: defineTable({
    name: v.string(),
    origin: v.string(),
    destination: v.string(),
    positionLabel: v.string(),
    leadName: v.string(),
    driverName: v.string(),
    hereLat: v.optional(v.number()),
    hereLng: v.optional(v.number()),
    hereAt: v.optional(v.number()),
    // Yatra's memory of the ASI:One conversation, so a restart keeps the trip.
    stage: v.optional(v.string()),
    dates: v.optional(v.string()),
    people: v.optional(v.array(v.string())),
    members: v.optional(v.array(v.string())),
    near: v.optional(v.string()),
    itinerary: v.optional(v.array(day)),
    itinerarySource: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_updated", ["updatedAt"]),
  messages: defineTable({
    tripId: v.id("trips"),
    author: v.string(),
    role: v.union(v.literal("human"), v.literal("agent"), v.literal("system")),
    body: v.string(),
    placesJson: v.optional(v.string()),
    menuJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_trip", ["tripId", "createdAt"]),
  orders: defineTable({
    tripId: v.id("trips"),
    placeName: v.string(),
    member: v.string(),
    item: v.string(),
    price: v.number(),
    createdAt: v.number(),
  }).index("by_trip", ["tripId", "createdAt"]),
  // Stays and things to do that the group votes on.
  options: defineTable({
    tripId: v.id("trips"),
    kind,
    name: v.string(),
    detail: v.string(),
    rating: v.string(),
    miles: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_trip", ["tripId", "kind"])
    .index("by_name", ["tripId", "kind", "name"]),
  votes: defineTable({
    tripId: v.id("trips"),
    kind,
    optionId: v.id("options"),
    voter: v.string(),
    createdAt: v.number(),
  })
    .index("by_trip", ["tripId", "kind"])
    .index("by_voter", ["tripId", "kind", "voter"]),
  // Each agent's ID card, written by the agent itself on startup.
  agents: defineTable({
    name: v.string(),
    handle: v.string(),
    address: v.string(),
    role: v.string(),
    protocols: v.array(v.string()),
    startedAt: v.number(),
  }).index("by_address", ["address"]),
  // Every action an agent takes, signed with the agent's own key. The key makes each action happen once.
  actions: defineTable({
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
    repeats: v.number(),
    ms: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_address", ["address", "at"])
    .index("by_at", ["at"]),
  monitorLogs: defineTable({
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
  }).index("by_trip", ["tripId", "createdAt"]),
});
