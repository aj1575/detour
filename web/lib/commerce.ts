export type Dish = {
  name: string;
  price: number;
  note: string;
};

const SAMPLE: Dish[] = [
  { name: "House breakfast plate", price: 16, note: "Eggs, toast, and fruit" },
  { name: "Veggie scramble", price: 15, note: "No meat" },
  { name: "Oatmeal and fruit", price: 11, note: "Lighter option" },
  { name: "Coffee and pastry", price: 8, note: "Quick stop" },
];

const MENU_NOTE = "Sample menu for the demo. The restaurant did not send this.";

export function buildMenu(placeName: string): { dishes: Dish[]; note: string } {
  void placeName;
  return { dishes: SAMPLE, note: MENU_NOTE };
}

export async function createEmbeddedCheckout(cents: number, description: string, idempotencyKey: string) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const publishable = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is missing.");
  if (!publishable) throw new Error("STRIPE_PUBLISHABLE_KEY is missing.");
  if (!secret.startsWith("sk_test_") || !publishable.startsWith("pk_test_")) {
    throw new Error("Refusing to open checkout because the Stripe keys are not test keys.");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + 1860;
  const body = new URLSearchParams({
    ui_mode: "embedded_page",
    mode: "payment",
    "redirect_on_completion": "if_required",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][price_data][product_data][name]": description.slice(0, 120),
    "line_items[0][price_data][product_data][description]": "Detour sample order. This is a Stripe test checkout.",
    return_url: "https://agentverse.ai/payment-success?session_id={CHECKOUT_SESSION_ID}",
    expires_at: String(expiresAt),
  });
  const payload = await stripe("checkout/sessions", body, idempotencyKey);
  if (!payload.id || !payload.client_secret) {
    throw new Error("Stripe did not return a checkout session.");
  }
  return {
    checkoutSessionId: payload.id,
    clientSecret: payload.client_secret,
    publishableKey: publishable,
    currency: "usd",
    amountCents: cents,
  };
}

export async function verifyCheckoutPaid(checkoutSessionId: string) {
  const payload = await stripe(`checkout/sessions/${encodeURIComponent(checkoutSessionId)}`);
  return {
    paid: payload.payment_status === "paid",
    amountCents: typeof payload.amount_total === "number" ? payload.amount_total : 0,
    status: payload.payment_status || payload.status || "unknown",
  };
}

async function stripe(path: string, body?: URLSearchParams, idempotencyKey?: string) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is missing.");
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body,
    signal: AbortSignal.timeout(20000),
  });
  const payload = (await response.json()) as {
    id?: string;
    client_secret?: string;
    payment_status?: string;
    status?: string;
    amount_total?: number;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || `Stripe returned ${response.status}.`);
  return payload;
}

export async function chargeTestPayment(cents: number, description: string, idempotencyKey: string) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is missing.");
  if (!secret.startsWith("sk_test_")) {
    throw new Error("Refusing to charge because the Stripe key is not a test key.");
  }
  const body = new URLSearchParams({
    amount: String(cents),
    currency: "usd",
    payment_method: "pm_card_visa",
    confirm: "true",
    description,
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
  });
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": idempotencyKey,
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const payload = (await response.json()) as { id?: string; status?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || `Stripe returned ${response.status}.`);
  }
  return { id: payload.id, status: payload.status || "unknown" };
}

export async function splitBill(
  description: string,
  cents: number,
  friendEmail: string,
  friendName = "Jordan",
) {
  const key = process.env.SPLITWISE_API_KEY;
  if (!key) throw new Error("SPLITWISE_API_KEY is missing.");
  const me = await splitwise(key, "get_current_user");
  const userId = me.user?.id;
  if (!userId) throw new Error(splitError(me) || "Splitwise did not return the current user.");

  const groupBody: Record<string, string> = {
    name: "Detour Highway 1",
    group_type: "trip",
  };
  if (friendEmail) {
    groupBody["users__0__email"] = friendEmail;
    groupBody["users__0__first_name"] = friendName;
    groupBody["users__0__last_name"] = "Detour";
  }
  const group = await splitwise(key, "create_group", groupBody);
  const groupId = group.group?.id;
  if (!groupId) throw new Error(splitError(group) || "Splitwise did not create a group.");

  const cost = money(cents);
  const friendShare = Math.floor(cents / 2);
  const payerShare = cents - friendShare;
  const expenseBody: Record<string, string> = {
    cost,
    description,
    currency_code: "USD",
    group_id: String(groupId),
  };
  if (friendEmail) {
    expenseBody["users__0__user_id"] = String(userId);
    expenseBody["users__0__paid_share"] = cost;
    expenseBody["users__0__owed_share"] = money(payerShare);
    expenseBody["users__1__email"] = friendEmail;
    expenseBody["users__1__paid_share"] = "0.00";
    expenseBody["users__1__owed_share"] = money(friendShare);
  } else {
    expenseBody.split_equally = "true";
  }
  const expense = await splitwise(key, "create_expense", expenseBody);
  const expenseId = expense.expenses?.[0]?.id;
  const error = splitError(expense);
  if (!expenseId || error) throw new Error(error || "Splitwise did not create the expense.");
  return { groupId, expenseId, shared: Boolean(friendEmail) };
}

async function splitwise(key: string, method: string, body?: Record<string, string>) {
  const response = await fetch(`https://secure.splitwise.com/api/v3.0/${method}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const payload = (await response.json().catch(() => ({}))) as SplitPayload;
  if (!response.ok) {
    throw new Error(splitError(payload) || `Splitwise ${method} returned ${response.status}.`);
  }
  return payload;
}

type SplitPayload = {
  user?: { id?: number };
  group?: { id?: number };
  expenses?: Array<{ id?: number }>;
  errors?: Record<string, unknown> | unknown[];
  error?: string;
};

function splitError(payload: SplitPayload) {
  if (typeof payload.error === "string" && payload.error) return payload.error;
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return JSON.stringify(payload.errors).slice(0, 220);
  }
  if (payload.errors && typeof payload.errors === "object" && Object.keys(payload.errors).length > 0) {
    return JSON.stringify(payload.errors).slice(0, 220);
  }
  return "";
}

function money(cents: number) {
  return (cents / 100).toFixed(2);
}
