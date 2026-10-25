import { api, convexClient } from "@/lib/convex";

// The agents' signed action log. Agents sign in Python; anyone can verify with the agent's address.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const op = String(body?.op ?? "");
  const client = convexClient();
  const text = (key: string, max = 600) => String(body?.[key] ?? "").slice(0, max);
  if (op === "register") {
    await client.mutation(api.actions.registerAgent, {
      name: text("name", 80),
      handle: text("handle", 80),
      address: text("address", 120),
      role: text("role", 300),
      protocols: Array.isArray(body?.protocols) ? body.protocols.map(String).slice(0, 10) : [],
    });
    return Response.json({ ok: true });
  }
  if (op === "claim") {
    return Response.json({ action: await client.mutation(api.actions.claim, { key: text("key", 300) }) });
  }
  if (op === "record") {
    await client.mutation(api.actions.record, {
      key: text("key", 300),
      agent: text("agent", 80),
      address: text("address", 120),
      kind: text("kind", 80),
      text: text("text"),
      result: text("result", 1200),
      status: body?.status === "error" ? "error" : "done",
      at: Number(body?.at) || Date.now(),
      digest: text("digest", 128),
      signature: text("signature", 300),
      ...(Number.isFinite(Number(body?.ms)) && body?.ms !== undefined ? { ms: Math.round(Number(body?.ms)) } : {}),
    });
    return Response.json({ ok: true });
  }
  if (op === "recent") {
    return Response.json({ actions: await client.query(api.actions.recent, { limit: Number(body?.limit) || 40 }) });
  }
  return Response.json({ error: "Use op register, claim, record, or recent." }, { status: 400 });
}
