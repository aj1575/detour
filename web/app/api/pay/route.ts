import { api, convexClient } from "@/lib/convex";
import { chargeTestPayment, splitBill } from "@/lib/commerce";
import type { Id } from "@/convex/_generated/dataModel";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: string;
    placeName?: string;
    friendEmail?: string;
    alexConfirmed?: boolean;
    jordanConfirmed?: boolean;
  } | null;
  if (!body?.tripId || !body.placeName?.trim()) {
    return Response.json({ error: "Need a trip and a place." }, { status: 400 });
  }
  if (!body.alexConfirmed || !body.jordanConfirmed) {
    return Response.json(
      { error: "Alex and Jordan both need to confirm this test payment." },
      { status: 400 },
    );
  }
  const friendEmail = body.friendEmail?.trim() || process.env.SPLITWISE_FRIEND_EMAIL?.trim() || "";
  const friendName = process.env.SPLITWISE_FRIEND_NAME?.trim() || "Jordan";
  if (friendEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(friendEmail)) {
    return Response.json({ error: "Enter a full email for the Splitwise share." }, { status: 400 });
  }

  const tripId = body.tripId as Id<"trips">;
  const placeName = body.placeName.trim();
  const client = convexClient();
  const orders = (await client.query(api.orders.list, { tripId })).filter(
    (order) => order.placeName === placeName,
  );
  if (orders.length === 0) {
    return Response.json({ error: "Add at least one item before paying." }, { status: 400 });
  }

  const cents = orders.reduce((sum, order) => sum + Math.round(order.price * 100), 0);
  if (cents < 50) return Response.json({ error: "The test total is below $0.50." }, { status: 400 });
  const dollars = (cents / 100).toFixed(2);
  const description = `Travel Assist AI demo order at ${placeName}`;

  try {
    const payment = await chargeTestPayment(cents, description, `detour-${orders.map((order) => order._id).join("-")}`);
    let splitNote = "";
    try {
      const split = await splitBill(`${description}. Stripe test ${payment.id}.`, cents, friendEmail, friendName);
      splitNote = split.shared
        ? `Splitwise expense ${split.expenseId} in group ${split.groupId}, split equally with ${friendName}. It shows on both Splitwise accounts.`
        : `Splitwise expense ${split.expenseId} in group ${split.groupId}. Set SPLITWISE_FRIEND_EMAIL to share it.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Splitwise failed.";
      splitNote = `The Stripe test payment succeeded, and Splitwise did not: ${message}`;
    }

    await client.mutation(api.messages.add, {
      tripId,
      author: "Cashier",
      role: "agent",
      body: `Proof of concept: Stripe test payment ${payment.id} is ${payment.status} for $${dollars} at ${placeName}, paid with Stripe's test Visa. No real money moved.`,
      createdAt: Date.now(),
    });
    await client.mutation(api.messages.add, {
      tripId,
      author: "Ledger",
      role: "agent",
      body: splitNote,
      createdAt: Date.now(),
    });
    await client.mutation(api.monitor.add, {
      tripId,
      intent: "payment",
      agent: "Cashier",
      plan: `Charge $${dollars} at ${placeName} and split it.`,
      status: "done",
      detail: `Stripe ${payment.id} ${payment.status}. ${splitNote}`,
      createdAt: Date.now(),
    });
    await client.mutation(api.orders.clearPlace, { tripId, placeName });
    return Response.json({ ok: true, paymentId: payment.id, status: payment.status, dollars, splitNote });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The test payment failed.";
    await client.mutation(api.monitor.add, {
      tripId,
      intent: "payment",
      agent: "Cashier",
      plan: `Charge $${dollars} at ${placeName} and split it.`,
      status: "error",
      detail,
      createdAt: Date.now(),
    });
    return Response.json({ error: detail }, { status: 502 });
  }
}
