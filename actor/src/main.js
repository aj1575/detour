import { Actor } from "apify";

await Actor.init();

try {
  const input = (await Actor.getInput()) ?? {};
  const query = String(input.query || "breakfast in Half Moon Bay, CA").slice(0, 180);
  const category = String(input.category || "place").slice(0, 40);
  const run = await Actor.call(
    "compass/crawler-google-places",
    {
      searchStringsArray: [query],
      maxCrawledPlacesPerSearch: 5,
      language: "en",
      maxImages: 0,
      maximumLeadsEnrichmentRecords: 0,
      scrapePlaceDetailPage: false,
    },
    { waitSecs: 70 },
  );
  const dataset = await Actor.openDataset(run.defaultDatasetId);
  const { items } = await dataset.getData();

  if (!items.length) {
    await Actor.pushData({
      name: "",
      buzzLabel: "",
      category,
      note: "The maps search returned no places.",
    });
  }

  for (const place of items.slice(0, 5)) {
    const reviews = Number(place.reviewsCount || 0);
    const buzz = Math.max(1, Math.min(100, Math.round(reviews / 15) || 1));
    await Actor.pushData({
      name: place.title || place.name || "Unnamed place",
      address: place.address || "",
      rating: place.totalScore ? `${place.totalScore} stars` : "Rating unavailable",
      phone: place.phone || "",
      reviews,
      buzz,
      buzzLabel: `${buzz} buzz from ${reviews} reviews`,
      category,
    });
  }
} catch (error) {
  await Actor.pushData({
    name: "",
    buzzLabel: "",
    note: error instanceof Error ? error.message : "route-buzz-finder failed.",
  });
}

await Actor.exit();
