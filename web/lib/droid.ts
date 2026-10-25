import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AutonomyLevel,
  OutputFormatType,
  ToolConfirmationOutcome,
  run,
} from "@factory/droid-sdk/node";
import { defaultQuery } from "@/lib/monitor";
import type { Intent, Plan } from "@/lib/monitor";

const EXEC_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@factory",
  "cli-win32-x64",
  "bin",
  "droid.exe",
);

const AGENTS: Record<Intent, string> = {
  breakfast: "Personal Chef",
  gas: "Pit Stop",
  medical: "Lifeline",
  menu: "Waiter",
  pay: "Cashier",
  split: "Ledger",
  trip: "Trip",
  stay: "Stays",
  activity: "Guide",
  itinerary: "Planner",
  post: "Curator",
  chitchat: "none",
};

const INTENTS = Object.keys(AGENTS) as Intent[];

const JUDGEMENT = {
  type: "object",
  properties: {
    intent: { type: "string", enum: INTENTS },
    near: { type: "string", maxLength: 120 },
    reason: { type: "string", maxLength: 200 },
  },
  required: ["intent", "near", "reason"],
  additionalProperties: false,
};

function prompt(text: string, town: string) {
  return `You are the judge for Travel Assist AI, a road-trip concierge on Highway 1. The group is near ${town}, CA.
Read one message and choose the single best intent. Do not answer the message. Do not use any tools.

trip: starting or planning a trip, a route, a destination, or who is coming. Atlas handles it.
breakfast: they want food or a place to eat now.
gas: fuel or a gas station.
medical: someone is hurt, sick, dizzy, or needs a clinic, pharmacy, or hospital.
menu: they want a stop's menu, or to add or order a dish.
pay: paying or checking out the group's order.
split: who owes what, or the Splitwise split.
stay: a place to sleep: a hotel, motel, inn, campsite, or where to stay tonight.
activity: things to do, sights, hikes, beaches, events, or attractions to visit.
itinerary: a day-by-day plan or schedule for a trip that is already set up.
post: pick the best trip photos for a social media post, or write a caption for them.
chitchat: anything else, such as thanks or comments about the view.

Rules:
- Medical outranks everything, even if food or gas is also mentioned.
- A word inside a place name is not a request. "Seattle" is not about eating.
- Judge what they want right now. "Road trip to Big Sur, we'll want breakfast" is trip.
- Paying for a meal is pay, not breakfast.
- Only saying where they are now, such as "we're in Monterey now", is chitchat with near set. trip is for planning a trip or saying who is coming.
- "Plan our days", "make an itinerary", or "what should we do each day" is itinerary, not trip. "Let's plan a trip" is trip.

near is the town, address, or landmark the person says they are at or want results near, written so a map search can find it, for example "Santa Cruz, CA". Use an empty string if they name no place. "me", "here", and "nearby" are not places.

Reply with intent, near, and a short reason.

Message: ${text}`;
}

// One Droid run with no tools that must return JSON matching the schema.
export async function askDroid<T>(
  text: string,
  schema: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ output: T | null; note: string }> {
  if (!process.env.FACTORY_API_KEY) return { output: null, note: "FACTORY_API_KEY is missing." };
  if (!existsSync(EXEC_PATH)) return { output: null, note: "The local droid.exe was not found in this project." };
  try {
    const result = await run(text, {
      apiKey: process.env.FACTORY_API_KEY,
      execPath: EXEC_PATH,
      cwd: mkdtempSync(path.join(tmpdir(), "detour-droid-")),
      autonomyLevel: AutonomyLevel.Off,
      disableBuiltinSkills: true,
      disabledToolIds: ["Script", "ToolSearch", "Execute", "Edit", "Create", "Read", "Grep"],
      abortSignal: AbortSignal.timeout(timeoutMs),
      permissionHandler: () => ToolConfirmationOutcome.Cancel,
      outputFormat: { type: OutputFormatType.JsonSchema, schema },
    });
    if (!result.success) {
      const detail = result.structuredOutputError?.message ?? result.error?.message ?? result.subtype;
      return { output: null, note: `Droid did not finish (${clip(String(detail))}).` };
    }
    return { output: result.structuredOutput as T, note: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Droid failed.";
    return { output: null, note: `Droid did not finish (${clip(message)}).` };
  }
}

export async function planWithDroid(
  text: string,
  town: string,
): Promise<{ plan: Plan | null; note: string }> {
  const { output, note } = await askDroid<{ intent?: string; near?: string; reason?: string }>(
    prompt(text, town),
    JUDGEMENT,
    28000,
  );
  if (!output) return { plan: null, note };
  const intent = INTENTS.find((name) => name === output.intent);
  if (!intent) {
    return { plan: null, note: "Droid returned an intent outside the list." };
  }
  const reason = clip(output.reason || `Chose ${intent}.`);
  return {
    plan: {
      intent,
      agent: AGENTS[intent],
      query: defaultQuery(intent, town),
      summary: reason,
      near: (output.near ?? "").trim().slice(0, 120),
    },
    note: `Droid judged: ${intent}. ${reason}`,
  };
}

function clip(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 180);
}
