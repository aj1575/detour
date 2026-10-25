import { scoreBuzz } from "@/lib/buzz";

export type Intent =
  | "breakfast"
  | "gas"
  | "medical"
  | "menu"
  | "pay"
  | "split"
  | "trip"
  | "stay"
  | "activity"
  | "itinerary"
  | "post"
  | "chitchat";

export type Plan = {
  intent: Intent;
  agent: string;
  query: string;
  summary: string;
  near?: string;
};

export type Place = {
  name: string;
  detail: string;
  rating: string;
  phone: string;
  status: string;
  buzz?: string;
  miles?: number;
};

export type Origin = { lat: number; lng: number; town: string; nearby?: boolean; byRelevance?: boolean };

export function nearbyQuery(intent: Intent, text: string) {
  if (intent === "gas") return "gas station";
  if (intent === "medical") return "urgent care clinic or hospital";
  if (intent === "stay") return /\b(camp|campsite|camping)\b/i.test(text) ? "campground" : "hotel";
  if (intent === "activity") return "things to do";
  return /\b(breakfast|brunch)\b/i.test(text) ? "breakfast restaurant" : "restaurant";
}

export async function geocode(place: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !place.trim()) return null;
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
      "x-goog-fieldmask": "places.location,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: place, maxResultCount: 1, languageCode: "en" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    places?: Array<{ location?: { latitude: number; longitude: number }; formattedAddress?: string }>;
  };
  const top = data.places?.[0];
  if (!top?.location) return null;
  return { lat: top.location.latitude, lng: top.location.longitude, label: place.trim() };
}

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function defaultQuery(intent: Intent, town: string) {
  if (intent === "gas") return `gas station in ${town}, CA`;
  if (intent === "medical") return `urgent care clinic or hospital in ${town}, CA`;
  if (intent === "breakfast") return `breakfast restaurant in ${town}, CA`;
  if (intent === "stay") return `hotel in ${town}, CA`;
  if (intent === "activity") return `things to do in ${town}, CA`;
  return "";
}

const FALLBACK: Array<[Intent, string, string[]]> = [
  ["medical", "Lifeline", ["dizzy", "hurt", "sick", "pain", "pharmacy", "hospital", "emergency", "clinic"]],
  ["post", "Curator", ["post", "caption", "curate", "instagram", "carousel", "album", "photos", "pics"]],
  ["itinerary", "Planner", ["itinerary", "schedule", "day by day", "plan our days", "plan the days"]],
  ["stay", "Stays", ["hotel", "motel", "inn", "stay", "lodging", "campsite", "camping", "airbnb", "sleep"]],
  ["activity", "Guide", ["things to do", "activities", "attractions", "sights", "hike", "hikes", "events"]],
  ["gas", "Pit Stop", ["gas", "fuel", "refuel"]],
  ["pay", "Cashier", ["pay", "checkout", "check out"]],
  ["split", "Ledger", ["split", "owe", "owes", "splitwise"]],
  ["menu", "Waiter", ["menu", "order"]],
  ["breakfast", "Personal Chef", ["breakfast", "brunch", "hungry", "starving", "food", "eat", "restaurant"]],
  ["trip", "Trip", ["trip", "road trip"]],
];

// Used when Droid cannot answer, so a request still reaches a specialist.
export function classify(text: string, town = "Half Moon Bay"): Plan {
  const lowered = text.replace(/’/g, "'").toLowerCase();
  const hit = FALLBACK.find(([, , words]) => new RegExp(`\\b(?:${words.join("|")})\\b`).test(lowered));
  const [intent, agent]: [Intent, string] = hit ? [hit[0], hit[1]] : ["chitchat", "none"];
  return {
    intent,
    agent,
    query: defaultQuery(intent, town),
    summary: intent === "chitchat" ? "No specialist was called." : `Traveler needs ${intent}. Route to ${agent}.`,
  };
}

export async function findPlaces(
  query: string,
  bias?: Origin,
  withBuzz = true,
): Promise<{ places: Place[]; source: string }> {
  const buzzPromise = withBuzz
    ? scoreBuzz(query)
    : Promise.resolve({ map: new Map<string, string>(), note: "Review buzz was skipped." });
  const googleError = await googlePlaces(query, bias).catch((error: unknown) => error);
  if (Array.isArray(googleError)) {
    const buzz = await withinBuzzBudget(buzzPromise);
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

function placeSource(bias: Origin | undefined, buzzNote: string) {
  const where = !bias
    ? "Google Places"
    : bias.nearby
      ? `Google Places, ranked by distance from ${bias.town}`
      : `Google Places, searched near ${bias.town} on the Highway 1 route from the Routes API`;
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
  if (query.startsWith("breakfast restaurant") || query.startsWith("restaurant")) return "restaurant";
  if (query.startsWith("hotel")) return "lodging";
  if (query.startsWith("campground")) return "campground";
  if (query.startsWith("things to do")) return "tourist_attraction";
  return "";
}

async function googlePlaces(query: string, bias?: Origin): Promise<Place[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is missing.");

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
      "x-goog-fieldmask":
        "places.displayName,places.formattedAddress,places.rating,places.nationalPhoneNumber,places.businessStatus,places.currentOpeningHours.openNow,places.location",
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
                radius: bias.nearby ? 8000 : 12000,
              },
            },
            ...(bias.nearby && !bias.byRelevance ? { rankPreference: "DISTANCE" } : {}),
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
      location?: { latitude: number; longitude: number };
    }>;
  };
  const places = (data.places ?? []).slice(0, 5).map((place): Place => {
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
      ...(bias?.nearby && place.location
        ? {
            miles:
              Math.round(
                milesBetween(bias, { lat: place.location.latitude, lng: place.location.longitude }) * 10,
              ) / 10,
          }
        : {}),
    };
  });
  if (places.length === 0) throw new Error("Google Places returned no places.");
  return places;
}

export function speakable(intent: Intent, places: Place[], near?: string) {
  const lines = places.map((place, index) => {
    const phone = place.phone ? `, ${place.phone}` : "";
    const buzz = place.buzz ? `, ${place.buzz}` : "";
    const away = typeof place.miles === "number" ? `, ${place.miles} mi away` : "";
    return `${index + 1}. ${place.name}${away}, ${place.detail}, ${place.rating}, ${place.status}${buzz}${phone}`;
  });
  const list = `${places.length} options. ${lines.join(" ")}`;
  const where = near ? `Closest to ${near}. ` : "";
  if (intent === "medical") {
    return `If this is an emergency, call 911 now. ${where}${list}`;
  }
  if (intent === "gas") return `${near ? where : "Fuel stops ahead. "}${list}`;
  if (intent === "stay") return `Places to stay${near ? ` near ${near}` : ""}. Vote for the one you want and I'll keep the tally. ${list}`;
  if (intent === "activity") return `Things to do${near ? ` near ${near}` : ""}. Vote for your favourite. ${list}`;
  return `${near ? where : "Food ahead on the route. "}${list}`;
}

function clip(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 180);
}

const BUZZ_BUDGET_MS = 4000;

// Review buzz is a bonus. Places go out after a short wait even if the Apify actor is still running.
function withinBuzzBudget(buzz: Promise<{ map: Map<string, string>; note: string }>) {
  const late = new Promise<{ map: Map<string, string>; note: string }>((resolve) =>
    setTimeout(
      () => resolve({ map: new Map(), note: "route-buzz-finder was still running, so places went out without buzz." }),
      BUZZ_BUDGET_MS,
    ),
  );
  return Promise.race([buzz, late]);
}
