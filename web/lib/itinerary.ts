import { askDroid } from "@/lib/droid";
import { findPlaces, geocode, type Origin, type Place } from "@/lib/monitor";

export type Stop = { time: string; place: string; note: string };
export type Day = { title: string; stops: Stop[] };

export type TripFacts = {
  origin: string;
  destination: string;
  dates: string;
  people: string[];
  stays: Array<{ name: string; votes: number }>;
  activities: Array<{ name: string; votes: number }>;
};

const PLAN = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 200 },
    days: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 80 },
          stops: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                time: { type: "string", maxLength: 20 },
                place: { type: "string", maxLength: 100 },
                note: { type: "string", maxLength: 140 },
              },
              required: ["time", "place", "note"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "stops"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "days"],
  additionalProperties: false,
};

function lines(places: Array<{ name: string; detail?: string; rating?: string; votes?: number }>) {
  if (places.length === 0) return "(none found)";
  return places
    .map((place) => {
      const votes = place.votes ? `, ${place.votes} group vote${place.votes === 1 ? "" : "s"}` : "";
      return `- ${place.name}${place.rating ? `, ${place.rating}` : ""}${votes}`;
    })
    .join("\n");
}

function prompt(facts: TripFacts, sights: Place[], food: Place[], request: string) {
  const who = facts.people.length ? `with ${facts.people.join(", ")}` : "";
  return `You plan road trips for Travel Assist AI. Build a realistic day-by-day itinerary. Do not use any tools.

Trip: ${facts.origin || "the Bay Area"} to ${facts.destination} ${who}.
Dates: ${facts.dates || "not given; plan 2 days"}.
What they asked: ${request}

Places to stay (the group voted; prefer the most votes):
${lines(facts.stays)}

Things to do near ${facts.destination} (prefer the ones with votes):
${lines([...facts.activities.filter((item) => item.votes > 0), ...sights])}

Places to eat near ${facts.destination}:
${lines(food)}

Rules:
- Use only places from these lists, plus drive legs written as "Drive from X to Y".
- One to three days. Infer the number of days from the dates.
- Each stop has a clock time like "9:00 AM", the place, and a short note on why.
- Day 1 starts by leaving ${facts.origin || "home"}. The last day ends with the drive home.
- summary is one sentence about the plan.`;
}

// Used when Droid is unavailable, so the group still gets a plan built from the same real places.
export function fallbackPlan(facts: TripFacts, sights: Place[], food: Place[]): Day[] {
  const stay = facts.stays[0]?.name;
  const voted = facts.activities.filter((item) => item.votes > 0).map((item) => item.name);
  const todo = [...new Set([...voted, ...sights.map((place) => place.name)])];
  const eat = food.map((place) => place.name);
  const from = facts.origin || "home";
  const pick = (list: string[], index: number, fallback: string) => list[index] ?? fallback;
  const first: Stop[] = [
    { time: "9:00 AM", place: `Drive from ${from} to ${facts.destination}`, note: "Leave early to beat traffic." },
    { time: "12:30 PM", place: pick(eat, 0, `Lunch in ${facts.destination}`), note: "Lunch when you arrive." },
    { time: "2:30 PM", place: pick(todo, 0, `Explore ${facts.destination}`), note: "The group's top pick." },
    { time: "6:30 PM", place: pick(eat, 1, "Dinner nearby"), note: "Dinner." },
  ];
  if (stay) first.push({ time: "8:30 PM", place: stay, note: "Check in. The group voted for it." });
  const second: Stop[] = [
    { time: "9:00 AM", place: pick(eat, 2, "Breakfast nearby"), note: "Breakfast." },
    { time: "10:30 AM", place: pick(todo, 1, `More of ${facts.destination}`), note: "Morning outing." },
    { time: "1:00 PM", place: pick(todo, 2, "Scenic stop on the way back"), note: "One more stop." },
    { time: "3:00 PM", place: `Drive from ${facts.destination} to ${from}`, note: "Head home." },
  ];
  return [
    { title: `Day 1: ${from} to ${facts.destination}`, stops: first },
    { title: `Day 2: ${facts.destination} and home`, stops: second },
  ];
}

export async function buildItinerary(facts: TripFacts, request: string) {
  const center = await geocode(facts.destination);
  const bias: Origin | undefined = center
    ? { lat: center.lat, lng: center.lng, town: facts.destination, nearby: true, byRelevance: true }
    : undefined;
  const [sights, food] = await Promise.all([
    findPlaces(center ? "things to do" : `things to do in ${facts.destination}`, bias, false)
      .then((found) => found.places)
      .catch(() => [] as Place[]),
    findPlaces(center ? "restaurant" : `restaurant in ${facts.destination}`, bias, false)
      .then((found) => found.places)
      .catch(() => [] as Place[]),
  ]);
  const { output, note } = await askDroid<{ summary: string; days: Day[] }>(
    prompt(facts, sights, food, request),
    PLAN,
    70000,
  );
  if (output?.days?.length) {
    return { days: output.days, summary: output.summary, source: "Factory Droid, from Google Places results" };
  }
  return {
    days: fallbackPlan(facts, sights, food),
    summary: `A two-day plan for ${facts.destination} built from Google Places.`,
    source: `Built without Droid. ${note}`,
  };
}
