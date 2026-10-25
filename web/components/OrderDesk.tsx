"use client";

import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";

type Dish = { name: string; price: number; note: string };
type Place = { name: string; status: string };
type Order = { _id: string; placeName: string; member: string; item: string; price: number };

export function OrderDesk({
  tripId,
  places,
  menu,
  orders,
  leadName,
  driverName,
}: {
  tripId: Id<"trips"> | null;
  places: Place[];
  menu: { placeName: string; dishes: Dish[]; note: string } | null;
  orders: Order[];
  leadName: string;
  driverName: string;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [alexConfirmed, setAlexConfirmed] = useState(false);
  const [jordanConfirmed, setJordanConfirmed] = useState(false);
  const [receipt, setReceipt] = useState("");

  const ticket = orders.filter((order) => !menu || order.placeName === menu.placeName);
  const total = ticket.reduce((sum, order) => sum + order.price, 0);

  async function post(url: string, body: object, label: string) {
    if (!tripId || busy) return;
    setBusy(label);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, ...body }),
      });
      const payload = (await response.json()) as { error?: string; splitNote?: string; paymentId?: string };
      if (!response.ok) {
        setError(payload.error || "That step did not finish.");
        return payload;
      }
      return payload;
    } catch {
      setError("The request did not finish.");
      return null;
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-label="Group order" className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <h2 className="font-semibold">Group order</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Sample menu, then a direct Stripe test charge on this page. ASI:One uses the Fetch payment card instead. {leadName} and {driverName} both confirm
        before anyone is charged.
      </p>
      {places.length === 0 ? (
        <p className="mt-3">Ask for breakfast first. The menu opens from a Personal Chef stop.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {places.map((place) => (
            <li key={place.name}>
              <button
                type="button"
                className="btn-secondary min-h-11 w-full rounded-xl px-3 text-left font-semibold"
                disabled={!tripId || Boolean(busy)}
                onClick={() => void post("/api/menu", { placeName: place.name }, place.name)}
              >
                {busy === place.name ? "Opening menu" : `See menu · ${place.name}`}
                <span className="mt-1 block text-sm font-normal text-[var(--muted)]">{place.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {menu ? (
        <div className="mt-4">
          <p className="font-semibold">{menu.placeName}</p>
          <p className="text-sm text-[var(--muted)]">{menu.note}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {menu.dishes.map((dish) => (
              <li key={dish.name} className="rounded-xl border border-[var(--line)] p-3">
                <p className="font-semibold">
                  {dish.name} · ${dish.price.toFixed(2)}
                </p>
                <p className="text-sm text-[var(--soft)]">{dish.note}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[leadName, driverName].map((member) => (
                    <button
                      key={member}
                      type="button"
                      className="btn-secondary min-h-11 rounded-xl px-3 font-semibold"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void post(
                          "/api/order",
                          { placeName: menu.placeName, member, item: dish.name },
                          `${member}-${dish.name}`,
                        )
                      }
                    >
                      {busy === `${member}-${dish.name}` ? "Adding" : `Add for ${member}`}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="font-semibold">Ticket · ${total.toFixed(2)}</p>
        {ticket.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No items yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {ticket.map((order) => (
              <li key={order._id}>
                {order.member}: {order.item} · ${order.price.toFixed(2)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="mt-4 grid gap-1 text-sm font-semibold">
        Jordan&apos;s Splitwise email
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@email.com"
          className="btn-secondary min-h-11 rounded-xl px-3"
        />
      </label>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Leave this blank to record the expense only on the signed-in Splitwise account.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={alexConfirmed}
            onChange={(event) => setAlexConfirmed(event.target.checked)}
          />
          Alex confirms this test payment
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={jordanConfirmed}
            onChange={(event) => setJordanConfirmed(event.target.checked)}
          />
          Jordan confirms this test payment
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary min-h-11 rounded-xl px-4 font-semibold"
          disabled={!menu || ticket.length === 0 || !alexConfirmed || !jordanConfirmed || Boolean(busy)}
          onClick={() => {
            if (!menu) return;
            void post(
              "/api/pay",
              {
                placeName: menu.placeName,
                friendEmail: email,
                alexConfirmed,
                jordanConfirmed,
              },
              "pay",
            ).then((payload) => {
              if (payload?.paymentId) {
                setReceipt(`Test payment ${payload.paymentId}. ${payload.splitNote ?? ""}`);
                setAlexConfirmed(false);
                setJordanConfirmed(false);
              }
            });
          }}
        >
          {busy === "pay" ? "Paying" : "Pay and split"}
        </button>
        {menu ? (
          <button
            type="button"
            className="btn-secondary min-h-11 rounded-xl px-4 font-semibold"
            disabled={Boolean(busy)}
            onClick={() => void post("/api/order", { placeName: menu.placeName, action: "clear" }, "clear")}
          >
            Clear ticket
          </button>
        ) : null}
      </div>
      {receipt ? <p className="mt-3">{receipt}</p> : null}
      {error ? (
        <p role="alert" className="mt-3 font-semibold">
          {error}
        </p>
      ) : null}
    </section>
  );
}
