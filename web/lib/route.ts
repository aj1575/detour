export type CoastRoute = {
  summary: string;
  town: string;
  lat: number;
  lng: number;
  pointCount: number;
};

const FALLBACK_TOWN = "Half Moon Bay";
const FALLBACK_POINT = { lat: 37.4636, lng: -122.4286 };

let cached: CoastRoute | null = null;

export async function getCoastRoute(): Promise<CoastRoute> {
  if (cached) return cached;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return fallback("GOOGLE_MAPS_API_KEY is missing.");

  try {
    const route = await computeRoute(key);
    cached = route;
    return route;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Routes API failed.";
    return fallback(message);
  }
}

async function computeRoute(key: string): Promise<CoastRoute> {
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
      "x-goog-fieldmask":
        "routes.duration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline,routes.legs.endLocation",
    },
    body: JSON.stringify({
      origin: { address: "San Francisco, CA" },
      destination: { address: "Big Sur, CA" },
      intermediates: [
        { address: "Pacifica, CA", via: true },
        { address: "Half Moon Bay, CA", via: true },
        { address: "Pescadero, CA", via: true },
        { address: "Davenport, CA", via: true },
        { address: "Santa Cruz, CA", via: true },
        { address: "Moss Landing, CA", via: true },
        { address: "Carmel-by-the-Sea, CA", via: true },
      ],
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      polylineQuality: "OVERVIEW",
      languageCode: "en-US",
      units: "METRIC",
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 220);
    throw new Error(detail || `Routes API returned ${response.status}.`);
  }

  const data = (await response.json()) as {
    routes?: Array<{
      duration?: string;
      distanceMeters?: number;
      description?: string;
      polyline?: { encodedPolyline?: string };
      legs?: Array<{ endLocation?: { latLng?: { latitude?: number; longitude?: number } } }>;
    }>;
  };
  const route = data.routes?.[0];
  const encoded = route?.polyline?.encodedPolyline;
  if (!route || !encoded) throw new Error("Routes API returned no Highway 1 polyline.");

  const points = decodePolyline(encoded);
  const onCoast =
    passesNear(points, { lat: 37.252, lng: -122.383 }, 8) &&
    passesNear(points, { lat: 36.555, lng: -121.923 }, 8);
  if (!onCoast) throw new Error("The computed route did not stay on Highway 1.");
  const legEnd = route.legs?.[0]?.endLocation?.latLng;
  const sample = points[Math.min(points.length - 1, Math.floor(points.length * 0.22))] ?? FALLBACK_POINT;
  const lat = legEnd?.latitude ?? sample.lat;
  const lng = legEnd?.longitude ?? sample.lng;
  const km = Math.max(1, Math.round((route.distanceMeters ?? 0) / 1000));
  const duration = formatDuration(route.duration);
  const via = /CA-1|Hwy 1|Highway 1/i.test(route.description ?? "")
    ? ` ${[...new Set((route.description ?? "").split(" and "))].join(" and ")}.`
    : " through Pacifica, Half Moon Bay, Santa Cruz, and Carmel.";
  return {
    summary: `Highway 1 from the Routes API · ${km} km · ${duration}.${via} ${points.length} route points.`,
    town: FALLBACK_TOWN,
    lat,
    lng,
    pointCount: points.length,
  };
}

function fallback(reason: string): CoastRoute {
  return {
    summary: `Using Half Moon Bay on Highway 1. ${reason}`,
    town: FALLBACK_TOWN,
    lat: FALLBACK_POINT.lat,
    lng: FALLBACK_POINT.lng,
    pointCount: 0,
  };
}

function passesNear(
  points: Array<{ lat: number; lng: number }>,
  target: { lat: number; lng: number },
  kilometers: number,
) {
  return points.some((point) => distanceKm(point, target) <= kilometers);
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDuration(raw: string | undefined) {
  const seconds = Number(String(raw ?? "").replace("s", ""));
  if (!Number.isFinite(seconds) || seconds <= 0) return "time unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes} min`;
  return `${hours} hr ${minutes} min`;
}

function decodePolyline(encoded: string) {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    const latitude = nextOffset();
    const longitude = nextOffset();
    lat += latitude;
    lng += longitude;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;

  function nextOffset() {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
