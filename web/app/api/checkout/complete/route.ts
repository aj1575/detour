import { api, convexClient } from "@/lib/convex";
import { splitBill, verifyCheckoutPaid } from "@/lib/commerce";
import type { Id } from "@/convex/_generated/dataModel";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: string;
    placeName?: string;
    checkoutSessionId?: string;
    friendEmail?: string;
  } | null;
  if (!body?.tripId || !body.placeName?.trim() || !body.checkoutSessionId?.trim()) {
    return Response.json({ error: "Need a trip, a place, and a checkout session." }, { status: 400 });
  }
  const tripId = body.tripId as Id<"trips">;
  const placeName = body.placeName.trim();
  const checkoutSessionId = body.checkoutSessionId.trim();
  const friendEmail = body.friendEmail?.trim() ?? "";
  const client = convexClient();
  const orders = (await client.query(api.orders.list, { tripId })).filter(
    (order) => order.placeName === placeName,
  );
  if (orders.length === 0) {
    return Response.json({ error: "Add at least one item before paying." }, { status: 400 });
  }
  const cents = orders.reduce((sum, order) => sum + Math.round(order.price * 100), 0);
  const dollars = (cents / 100).toFixed(2);
  const description = `Detour demo order at ${placeName}`;

  let paid: { paid: boolean; amountCents: number; status: string };
  try {
    paid = await verifyCheckoutPaid(checkoutSessionId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Stripe could not be checked.";
    return Response.json({ error: detail }, { status: 502 });
  }
  if (!paid.paid) {
    return Response.json(
      { error: "Stripe payment not completed yet. Finish checkout, then approve again." },
      { status: 409 },
    );
  }
  if (paid.amountCents !== cents) {
    return Response.json({ error: "The paid amount does not match the order." }, { status: 409 });
  }

  let splitNote = "";
  try {
    const split = await splitBill(`${description}. Stripe test ${checkoutSessionId}.`, cents, friendEmail);
    splitNote = split.shared
      ? `Splitwise expense ${split.expenseId} in group ${split.groupId}, split equally.`
      : `Splitwise expense ${split.expenseId} in group ${split.groupId}. Add Jordan's email to share it.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Splitwise failed.";
    splitNote = `The Stripe test payment succeeded, and Splitwise did not: ${message}`;
  }

  await client.mutation(api.messages.add, {
    tripId,
    author: "Cashier",
    role: "agent",
    body: `Fetch payment ${checkoutSessionId} is paid for $${dollars} at ${placeName}. Stripe test checkout. This is not a real charge.`,
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
    plan: `Verify $${dollars} at ${placeName} and split it.`,
    status: "done",
    detail: `Stripe ${checkoutSessionId} ${paid.status}. ${splitNote}`,
    createdAt: Date.now(),
  });
  await client.mutation(api.orders.clearPlace, { tripId, placeName });
  return Response.json({ ok: true, paymentId: checkoutSessionId, status: paid.status, splitNote });
}
