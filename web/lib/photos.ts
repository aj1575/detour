import sharp from "sharp";
import { askDroid } from "@/lib/droid";

export type Look = {
  hue: number;
  saturation: number;
  brightness: number;
  warmth: number;
  contrast: number;
  sharpness: number;
  colorfulness: number;
  hues: number[];
  palette: string[];
  theme: string;
  score: number;
};

export type AlbumPhoto = { _id: string; url: string; look: Look; createdAt: number };

const HUE_BINS = 12;
const DISPLAY_EDGE = 1600;

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function hsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, saturation: max === 0 ? 0 : delta / max, value: max };
}

function hex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

function themeOf(look: Omit<Look, "theme" | "score" | "palette" | "hues">) {
  const hue = look.hue;
  if (look.brightness < 0.28) return "moody night";
  if (look.saturation < 0.12) return "soft neutrals";
  if (look.warmth > 0.06 && (hue < 65 || hue > 330)) return "golden hour";
  if (hue >= 170 && hue <= 255) return "ocean blues";
  if (hue >= 70 && hue < 170) return "forest greens";
  if (look.brightness > 0.68 && look.saturation < 0.3) return "bright and airy";
  return "vivid road trip";
}

// Shrinks the photo for display and measures its look: color mood, exposure, and sharpness.
export async function measurePhoto(input: Buffer) {
  const display = await sharp(input)
    .rotate()
    .resize({ width: DISPLAY_EDGE, height: DISPLAY_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const stats = await sharp(display.data).stats();
  const pixels = await sharp(display.data).resize(48, 48, { fit: "cover" }).removeAlpha().raw().toBuffer();

  const hues = new Array(HUE_BINS).fill(0);
  const bins = new Map<string, { r: number; g: number; b: number; n: number }>();
  let sumS = 0, sumV = 0, sumV2 = 0, sumWarm = 0, hueX = 0, hueY = 0;
  let sumRG = 0, sumYB = 0, sumRG2 = 0, sumYB2 = 0;
  const count = pixels.length / 3;
  for (let index = 0; index < pixels.length; index += 3) {
    const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const { hue, saturation, value } = hsv(r / 255, g / 255, b / 255);
    const weight = saturation * value;
    hues[Math.floor(hue / (360 / HUE_BINS)) % HUE_BINS] += weight;
    hueX += Math.cos((hue * Math.PI) / 180) * weight;
    hueY += Math.sin((hue * Math.PI) / 180) * weight;
    sumS += saturation;
    sumV += value;
    sumV2 += value * value;
    sumWarm += (r - b) / 255;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    sumRG += rg;
    sumYB += yb;
    sumRG2 += rg * rg;
    sumYB2 += yb * yb;
    const key = `${r >> 6}${g >> 6}${b >> 6}`;
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bins.set(key, { r: bin.r + r, g: bin.g + g, b: bin.b + b, n: bin.n + 1 });
  }
  const meanV = sumV / count;
  const meanRG = sumRG / count, meanYB = sumYB / count;
  const stdRG = Math.sqrt(Math.max(0, sumRG2 / count - meanRG ** 2));
  const stdYB = Math.sqrt(Math.max(0, sumYB2 / count - meanYB ** 2));
  const totalHue = hues.reduce((sum, value) => sum + value, 0) || 1;
  const base = {
    hue: round(((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360, 1),
    saturation: round(sumS / count),
    brightness: round(meanV),
    warmth: round(sumWarm / count),
    contrast: round(Math.sqrt(Math.max(0, sumV2 / count - meanV ** 2))),
    sharpness: round(stats.sharpness),
    colorfulness: round((Math.sqrt(stdRG ** 2 + stdYB ** 2) + 0.3 * Math.sqrt(meanRG ** 2 + meanYB ** 2)) / 255),
  };
  const palette = [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((bin) => hex(bin.r / bin.n, bin.g / bin.n, bin.b / bin.n));
  // A 0-10 look score: sharp, well exposed, colorful, with some contrast.
  const score =
    10 *
    (0.35 * clamp(Math.log1p(base.sharpness) / Math.log1p(6)) +
      0.25 * clamp(1 - Math.abs(base.brightness - 0.5) * 2) +
      0.25 * clamp(base.colorfulness / 0.45) +
      0.15 * clamp(base.contrast / 0.25));
  const look: Look = {
    ...base,
    hues: hues.map((value) => round(value / totalHue)),
    palette,
    theme: themeOf(base),
    score: round(score, 2),
  };
  return { image: display.data, width: display.info.width, height: display.info.height, look };
}

function vector(look: Look) {
  const angle = (look.hue * Math.PI) / 180;
  return [
    Math.cos(angle) * look.saturation * 2,
    Math.sin(angle) * look.saturation * 2,
    look.saturation,
    look.brightness * 1.5,
    look.warmth * 3,
    look.contrast * 2,
    ...look.hues.map((value) => value * 1.2),
  ];
}

function distance(a: number[], b: number[]) {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
}

// Picks the set that looks best together: high look scores and a shared color story.
export function curate(photos: AlbumPhoto[], avoid: string[] = []) {
  if (photos.length === 0) return null;
  const size = photos.length < 3 ? photos.length : Math.min(6, Math.max(3, Math.round(photos.length / 2)));
  const vectors = new Map(photos.map((photo) => [photo._id, vector(photo.look)]));
  const avoided = new Set(avoid);
  let best: { set: AlbumPhoto[]; value: number; cohesion: number } | null = null;
  for (const seed of photos) {
    const set = [...photos]
      .sort((a, b) => distance(vectors.get(seed._id)!, vectors.get(a._id)!) - distance(vectors.get(seed._id)!, vectors.get(b._id)!))
      .slice(0, size);
    const signature = set.map((photo) => photo._id).sort().join(",");
    if (avoided.has(signature) && photos.length > size) continue;
    let pairs = 0, spread = 0;
    for (let i = 0; i < set.length; i += 1) {
      for (let j = i + 1; j < set.length; j += 1) {
        spread += distance(vectors.get(set[i]._id)!, vectors.get(set[j]._id)!);
        pairs += 1;
      }
    }
    const cohesion = pairs ? spread / pairs : 0;
    const quality = set.reduce((sum, photo) => sum + photo.look.score, 0) / set.length / 10;
    const value = quality - 0.8 * cohesion;
    if (!best || value > best.value) best = { set, value, cohesion };
  }
  if (!best) return null;
  const cover = [...best.set].sort((a, b) => b.look.score - a.look.score)[0];
  const ordered = [cover, ...best.set.filter((photo) => photo !== cover).sort(
    (a, b) => distance(vectors.get(cover._id)!, vectors.get(a._id)!) - distance(vectors.get(cover._id)!, vectors.get(b._id)!),
  )];
  const themes = new Map<string, number>();
  for (const photo of ordered) themes.set(photo.look.theme, (themes.get(photo.look.theme) ?? 0) + 1);
  const theme = [...themes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    photos: ordered,
    theme,
    signature: ordered.map((photo) => photo._id).sort().join(","),
    cohesion: round(best.cohesion),
    palette: [...new Set(ordered.flatMap((photo) => photo.look.palette.slice(0, 2)))].slice(0, 5),
  };
}

const CAPTION = {
  type: "object",
  properties: {
    caption: { type: "string", maxLength: 280 },
    hashtags: { type: "array", minItems: 3, maxItems: 6, items: { type: "string", maxLength: 30 } },
  },
  required: ["caption", "hashtags"],
  additionalProperties: false,
};

export type TripMood = { origin: string; destination: string; dates: string; people: string[]; stops: string[] };

// Droid writes the caption from the trip and the set's color story. It does not see the pixels.
export async function writeCaption(trip: TripMood, theme: string, palette: string[], count: number, request: string) {
  const where = trip.destination || "the road";
  const prompt = `You write social media captions for Detour, a group road-trip app. Do not use any tools.
Write one caption for a carousel of ${count} trip photos the group took.

Trip: ${trip.origin ? `${trip.origin} to ` : ""}${where}${trip.dates ? `, ${trip.dates}` : ""}.
Friends on the trip: ${trip.people.length ? trip.people.join(", ") : "a group of friends"}.
Places on the plan: ${trip.stops.length ? trip.stops.slice(0, 6).join(", ") : "the drive itself"}.
The photos share a "${theme}" look. Their palette: ${palette.join(", ")}.
What they asked: ${request}

Rules:
- One to three short sentences, warm and specific to ${where}. At most one emoji.
- Describe the mood and the trip. Do not name objects or people that may not be in the photos.
- hashtags: three to six, each starting with #, no spaces.`;
  const { output, note } = await askDroid<{ caption: string; hashtags: string[] }>(prompt, CAPTION, 45000);
  if (output?.caption) {
    const hashtags = output.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`).replace(/\s+/g, ""));
    return { caption: output.caption.trim(), hashtags, source: "Caption by Factory Droid" };
  }
  const tag = where.replace(/[^A-Za-z0-9]/g, "");
  return {
    caption: `${theme[0].toUpperCase()}${theme.slice(1)} on the way to ${where}. Same road, same crew, too many photos.`,
    hashtags: [`#${tag || "RoadTrip"}`, "#RoadTrip", "#Detour", `#${theme.replace(/\s+/g, "")}`],
    source: `Caption from a template. ${note}`,
  };
}
