type BuzzHit = { name?: string; buzzLabel?: string };

let username: string | null = null;

export async function scoreBuzz(query: string): Promise<{ map: Map<string, string>; note: string }> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { map: new Map(), note: "APIFY_TOKEN is missing, so route-buzz-finder did not run." };

  try {
    const owner = await actorOwner(token);
    const response = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(owner)}~route-buzz-finder/run-sync-get-dataset-items?timeout=18`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, category: "place" }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
      return {
        map: new Map(),
        note: `route-buzz-finder was not ready (${response.status}${detail ? `: ${detail}` : ""}).`,
      };
    }
    const rows = (await response.json()) as BuzzHit[];
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.name && row.buzzLabel) map.set(row.name.toLowerCase(), row.buzzLabel);
    }
    if (map.size === 0) {
      return { map, note: "route-buzz-finder ran and returned no scored places." };
    }
    return { map, note: "route-buzz-finder added review buzz." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "route-buzz-finder failed.";
    return { map: new Map(), note: `route-buzz-finder did not finish (${message.replace(/\s+/g, " ").slice(0, 140)}).` };
  }
}

async function actorOwner(token: string) {
  if (username) return username;
  const response = await fetch("https://api.apify.com/v2/users/me", {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Apify did not return the account username.");
  const data = (await response.json()) as { data?: { username?: string } };
  const name = data.data?.username;
  if (!name) throw new Error("Apify account username was empty.");
  username = name;
  return name;
}
