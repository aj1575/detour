import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { day } from "./schema";

// A friend who messages Yatra within this window joins the active trip.
const JOIN_WINDOW_MS = 12 * 60 * 60 * 1000;
const LOCATION_TTL_MS = 6 * 60 * 60 * 1000;

async function latest(ctx: QueryCtx) {
  return (
    (await ctx.db.query("trips").withIndex("by_updated").order("desc").first()) ??
    (await ctx.db.query("trips").first())
  );
}

async function memberTrip(ctx: QueryCtx, chat: string) {
  const trips = await ctx.db.query("trips").withIndex("by_updated").order("desc").take(50);
  return trips.find((trip) => trip.members?.includes(chat)) ?? null;
}

function title(origin: string, destination: string) {
  if (origin && destination) return `${origin} to ${destination}`;
  return destination || origin || "New trip";
}

export const ensureDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await latest(ctx);
    if (existing) return existing._id;
    const tripId = await ctx.db.insert("trips", {
      name: "SF to Big Sur",
      origin: "San Francisco",
      destination: "Big Sur",
      positionLabel: "Half Moon Bay, Highway 1",
      leadName: "Alex",
      driverName: "Jordan",
      people: ["Alex", "Jordan"],
      updatedAt: Date.now(),
    });
    await ctx.db.insert("messages", {
      tripId,
      author: "Detour",
      role: "system",
      body: "Trip board for Alex, the trip lead, and Jordan, the driver. Message Yatra in ASI:One and this page updates live.",
      createdAt: Date.now(),
    });
    return tripId;
  },
});

// The trip the board shows: whichever trip the group touched last.
export const current = query({
  args: {},
  handler: async (ctx) => await latest(ctx),
});

export const setHere = mutation({
  args: { tripId: v.id("trips"), lat: v.number(), lng: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tripId, { hereLat: args.lat, hereLng: args.lng, hereAt: Date.now() });
  },
});

export const get = query({
  args: { tripId: v.id("trips") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tripId);
  },
});

function crewView(trip: Doc<"trips"> | null) {
  if (!trip?.stage) return null;
  return {
    tripId: trip._id,
    stage: trip.stage,
    start: trip.origin,
    end: trip.destination,
    dates: trip.dates ?? "",
    people: trip.people ?? null,
    near: trip.near ?? "",
  };
}

// Yatra's trip for one ASI:One sender. A new sender joins the trip in progress.
export const loadCrew = mutation({
  args: { chat: v.string() },
  handler: async (ctx, { chat }) => {
    const own = await memberTrip(ctx, chat);
    if (own) return crewView(own);
    const active = await latest(ctx);
    if (!active?.stage || Date.now() - (active.updatedAt ?? 0) > JOIN_WINDOW_MS) return null;
    await ctx.db.patch(active._id, { members: [...(active.members ?? []), chat] });
    return crewView(active);
  },
});

export const saveCrew = mutation({
  args: {
    chat: v.string(),
    fresh: v.boolean(),
    stage: v.string(),
    start: v.optional(v.string()),
    end: v.optional(v.string()),
    dates: v.optional(v.string()),
    people: v.optional(v.union(v.array(v.string()), v.null())),
    near: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const origin = args.start ?? "";
    const destination = args.end ?? "";
    const people = args.people ?? undefined;
    const fields = {
      name: title(origin, destination),
      origin,
      destination,
      stage: args.stage,
      dates: args.dates ?? "",
      people,
      near: args.near ?? "",
      driverName: people?.[0] ?? "",
      positionLabel: args.near || origin || "Not shared yet",
      updatedAt: Date.now(),
    };
    const existing = args.fresh ? null : await memberTrip(ctx, args.chat);
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    // A fresh trip takes this sender out of any older trip.
    const older = await ctx.db.query("trips").withIndex("by_updated").order("desc").take(50);
    for (const trip of older) {
      if (trip.members?.includes(args.chat)) {
        await ctx.db.patch(trip._id, { members: trip.members.filter((member) => member !== args.chat) });
      }
    }
    const tripId = await ctx.db.insert("trips", { ...fields, leadName: "Me", members: [args.chat] });
    await ctx.db.insert("messages", {
      tripId,
      author: "Yatra",
      role: "system",
      body: "A new trip started in ASI:One. This board updates live as the group plans.",
      createdAt: Date.now(),
    });
    return tripId;
  },
});

export const setItinerary = mutation({
  args: { tripId: v.id("trips"), days: v.array(day), source: v.string() },
  handler: async (ctx, { tripId, days, source }) => {
    await ctx.db.patch(tripId, { itinerary: days, itinerarySource: source, updatedAt: Date.now() });
  },
});

// Run by a cron: a shared location is private, so it is forgotten after six hours.
export const forgetOldLocations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - LOCATION_TTL_MS;
    const trips = await ctx.db.query("trips").collect();
    for (const trip of trips) {
      if (trip.hereAt !== undefined && trip.hereAt < cutoff) {
        await ctx.db.patch(trip._id, { hereLat: undefined, hereLng: undefined, hereAt: undefined });
      }
    }
  },
});
