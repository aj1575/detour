import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  trips: defineTable({
    name: v.string(),
    origin: v.string(),
    destination: v.string(),
    positionLabel: v.string(),
    leadName: v.string(),
    driverName: v.string(),
  }),
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
