import { scoreBuzz } from "@/lib/buzz";

export type Intent =
  | "breakfast"
  | "gas"
  | "medical"
  | "menu"
  | "pay"
  | "split"
  | "trip"
  | "chitchat";

export type Plan = {
  intent: Intent;
  agent: string;
  query: string;
  summary: string;
};

export type Place = {
  name: string;
  detail: string;
  rating: string;
  phone: string;
  status: string;
  buzz?: string;
};

export function defaultQuery(intent: Intent, town: string) {
  if (intent === "gas") return `gas station in ${town}, CA`;
  if (intent === "medical") return `urgent care clinic or hospital in ${town}, CA`;
  if (intent === "breakfast") return `breakfast restaurant in ${town}, CA`;
  return "";
}

export function classify(text: string, town = "Half Moon Bay"): Plan {
  const lowered = text.toLowerCase();
  const intent: Intent = ["dizzy", "hurt", "sick", "pain", "pharmacy", "hospital", "emergency"].some(
    (word) => lowered.includes(word),
  )
    ? "medical"
    : ["gas", "fuel"].some((word) => lowered.includes(word))
      ? "gas"
      : ["breakfast", "hungry", "starving", "food", "eat", "restaurant"].some((word) =>
            lowered.includes(word),
          )
        ? "breakfast"
        : "chitchat";
  const agent =
    intent === "breakfast"
      ? "Personal Chef"
      : intent === "gas"
        ? "Pit Stop"
        : intent === "medical"
          ? "Lifeline"
          : "none";
  return {
    intent,
    agent,
    query: defaultQuery(intent, town),
    summary:
      intent === "chitchat"
        ? "No specialist was called."
        : `Traveler needs ${intent}. Route to ${agent}.`,
  };
}

export async function findPlaces(
  query: string,
  bias?: { lat: number; lng: number; town: string },
): Promise<{ places: Place[]; source: string }> {
  const buzzPromise = scoreBuzz(query);
  const googleError = await googlePlaces(query, bias).catch((error: unknown) => error);
  if (Array.isArray(googleError)) {
    const buzz = await buzzPromise;
    return { places: mergeBuzz(googleError, buzz.map), source: placeSource(bias, buzz.note) };
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    const message = googleError instanceof Error ? googleError.message : "Google Places failed.";
    throw new Error(message);
  }

  const response = await fetch(
    "https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?timeout=50",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: 5,
        language: "en",
        maxImages: 0,
        maximumLeadsEnrichmentRecords: 0,
        scrapePlaceDetailPage: false,
      }),
      signal: AbortSignal.timeout(55000),
    },
  );

  if (!response.ok) {
    throw new Error(clip(await response.text()) || `Apify returned ${response.status}.`);
  }

  const rows = (await response.json()) as Array<Record<string, unknown>>;
  const places = rows.slice(0, 5).map((row) => {
    const name = String(row.title || row.name || "Unnamed place");
    const address = String(row.address || row.neighborhood || "Address unavailable");
    const score = row.totalScore ?? row.stars;
    const rating =
      typeof score === "number" && score > 0 ? `${score} stars` : "Rating unavailable";
    const phone = String(row.phone || row.phoneUnformatted || "");
    const status = row.permanentlyClosed ? "Closed" : "Hours not checked";
    return { name, detail: address, rating, phone, status };
  });

  if (places.length === 0) {
    throw new Error("Apify returned no places for that search.");
  }
  const reason = googleError instanceof Error ? googleError.message : "Google Places was unavailable.";
  const buzz = await buzzPromise;
  return {
    places: mergeBuzz(places, buzz.map),
    source: `Apify compass crawler, because ${reason}. ${buzz.note}`,
  };
}

function placeSource(bias: { town: string } | undefined, buzzNote: string) {
  const where = bias
    ? `Google Places, searched near ${bias.town} on the Highway 1 route from the Routes API`
    : "Google Places";
  return `${where}. ${buzzNote.replace(/\.$/, "")}.`;
}

function mergeBuzz(places: Place[], buzz: Map<string, string>) {
  if (buzz.size === 0) return places;
  return places.map((place) => {
    const direct = buzz.get(place.name.toLowerCase());
    if (direct) return { ...place, buzz: direct };
    const fuzzy = [...buzz.entries()].find(
      ([name]) => place.name.toLowerCase().includes(name) || name.includes(place.name.toLowerCase()),
    );
    return fuzzy ? { ...place, buzz: fuzzy[1] } : place;
  });
}

function placeType(query: string) {
  if (query.startsWith("gas station")) return "gas_station";
  if (query.startsWith("breakfast restaurant")) return "restaurant";
  return "";
}

async function googlePlaces(
  query: string,
  bias?: { lat: number; lng: number },
): Promise<Place[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is missing.");

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
      "x-goog-fieldmask":
        "places.displayName,places.formattedAddress,places.rating,places.nationalPhoneNumber,places.businessStatus,places.currentOpeningHours.openNow",
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 5,
      languageCode: "en",
      ...(placeType(query) ? { includedType: placeType(query), strictTypeFiltering: true } : {}),
      ...(bias
        ? {
            locationBias: {
              circle: {
                center: { latitude: bias.lat, longitude: bias.lng },
                radius: 12000,
              },
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(clip(await response.text()) || `Google Places returned ${response.status}.`);
  }

  const data = (await response.json()) as {
    places?: Array<{
      displayName?: { text?: string };
      formattedAddress?: string;
      rating?: number;
      nationalPhoneNumber?: string;
      businessStatus?: string;
      currentOpeningHours?: { openNow?: boolean };
    }>;
  };
  const places = (data.places ?? []).slice(0, 5).map((place) => {
    const closed =
      place.businessStatus === "CLOSED_PERMANENTLY" ||
      place.businessStatus === "CLOSED_TEMPORARILY" ||
      place.currentOpeningHours?.openNow === false;
    const status =
      place.currentOpeningHours?.openNow === true ? "Open" : closed ? "Closed" : "Hours unavailable";
    return {
      name: place.displayName?.text || "Unnamed place",
      detail: place.formattedAddress || "Address unavailable",
      rating: typeof place.rating === "number" ? `${place.rating} stars` : "Rating unavailable",
      phone: place.nationalPhoneNumber || "",
      status,
    };
  });
  if (places.length === 0) throw new Error("Google Places returned no places.");
  return places;
}

export function speakable(intent: Intent, places: Place[]) {
  const lines = places.map((place, index) => {
    const phone = place.phone ? `, ${place.phone}` : "";
    const buzz = place.buzz ? `, ${place.buzz}` : "";
    return `${index + 1}. ${place.name}, ${place.detail}, ${place.rating}, ${place.status}${buzz}${phone}`;
  });
  const list = `${places.length} options. ${lines.join(" ")}`;
  if (intent === "medical") {
    return `If this is an emergency, call 911 now. ${list}`;
  }
  if (intent === "gas") return `Fuel stops ahead. ${list}`;
  return `Food ahead on the route. ${list}`;
}
