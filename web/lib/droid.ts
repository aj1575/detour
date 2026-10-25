import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  AutonomyLevel,
  DroidMessageType,
  ToolConfirmationOutcome,
  createSdkMcpServer,
  createSession,
  tool,
} from "@factory/droid-sdk/node";
import type { Intent, Plan } from "@/lib/monitor";

const EXEC_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@factory",
  "cli-win32-x64",
  "bin",
  "droid.exe",
);

const ALLOWED = ["dispatch_to_agent", "read_trip_state", "post_to_chat"];

function agentFor(intent: Intent) {
  if (intent === "breakfast") return "Personal Chef";
  if (intent === "gas") return "Pit Stop";
  if (intent === "medical") return "Lifeline";
  if (intent === "menu") return "Waiter";
  if (intent === "pay") return "Cashier";
  if (intent === "split") return "Ledger";
  if (intent === "trip") return "Trip";
  return "none";
}

export async function planWithDroid(
  text: string,
  town: string,
): Promise<{ plan: Plan | null; note: string }> {
  if (!process.env.FACTORY_API_KEY) {
    return { plan: null, note: "FACTORY_API_KEY is missing." };
  }
  if (!existsSync(EXEC_PATH)) {
    return { plan: null, note: "The local droid.exe was not found in this project." };
  }

  let dispatched: Plan | null = null;
  const called: string[] = [];
  const detour = createSdkMcpServer({
    name: "detour",
    version: "0.1.0",
    tools: [
      tool(
        "read_trip_state",
        "Read the current road-trip position. Read only.",
        {},
        async () =>
          `Town: ${town}, CA. Route: San Francisco to Big Sur on Highway 1. Riders: Alex and Jordan.`,
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "dispatch_to_agent",
        "Call exactly one specialist, then stop.",
        {
          intent: z.enum(["breakfast", "gas", "medical", "menu", "pay", "split", "trip", "chitchat"]),
          query: z.string().min(3).max(160),
          summary: z.string().min(3).max(240),
        },
        async (args) => {
          called.push("dispatch_to_agent");
          if (dispatched) return "One specialist is already chosen. Stop.";
          const query = args.query.toLowerCase().includes(town.toLowerCase())
            ? args.query
            : `${args.query} in ${town}, CA`;
          dispatched = {
            intent: args.intent,
            agent: agentFor(args.intent),
            query,
            summary: args.summary,
          };
          return `Dispatched ${dispatched.agent}. Stop now.`;
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "post_to_chat",
        "Record a short note. This does not call a second specialist.",
        { text: z.string().max(240) },
        async () => {
          called.push("post_to_chat");
          return "Noted.";
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });

  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  try {
    session = await createSession({
      apiKey: process.env.FACTORY_API_KEY,
      execPath: EXEC_PATH,
      cwd: mkdtempSync(path.join(tmpdir(), "detour-droid-")),
      autonomyLevel: AutonomyLevel.Off,
      disableBuiltinSkills: true,
      disabledToolIds: ["Script", "ToolSearch", "Execute", "Edit", "Create", "Read", "Grep"],
      abortSignal: AbortSignal.timeout(28000),
      mcpServers: [detour],
      permissionHandler({ toolUses }) {
        const blob = JSON.stringify(toolUses);
        const allowed = ALLOWED.some((name) => blob.includes(name));
        return allowed ? ToolConfirmationOutcome.ProceedOnce : ToolConfirmationOutcome.Cancel;
      },
    });

    const prompt = `You are the Detour monitor. Read one message from a two-person road trip and call exactly one specialist.
Call read_trip_state if you need the town, then call dispatch_to_agent once.
intent breakfast means Personal Chef, gas means Pit Stop, medical means Lifeline.
intent menu means Waiter: seeing a menu, or adding or ordering a dish at a stop.
intent pay means Cashier: paying, checking out, or settling the order.
intent split means Ledger: who owes what, or the Splitwise split.
intent trip means the trip captain: starting or planning a road trip, or saying who is coming.
If someone is hurt, dizzy, or needs a pharmacy or hospital, intent is medical even if they also mention food or gas.
intent chitchat means no specialist.
query is a short maps search that includes ${town}, CA.
Do not edit files, run commands, or call any other tool.

Message: ${text}`;

    for await (const message of session.stream(prompt)) {
      if (
        message.type === DroidMessageType.ToolCall &&
        ALLOWED.some((name) => message.name.includes(name))
      ) {
        called.push(message.name.includes("dispatch_to_agent") ? "dispatch_to_agent" : message.name);
      }
      if (message.type === DroidMessageType.Result && !message.success && !dispatched) {
        throw new Error(message.error?.message ?? "Droid did not finish.");
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Droid failed.";
    return { plan: dispatched, note: `Droid did not finish (${clip(message)}).` };
  } finally {
    await session?.close().catch(() => undefined);
  }

  if (!dispatched) {
    return { plan: null, note: "Droid finished without calling dispatch_to_agent." };
  }
  const unique = [...new Set(called)];
  return { plan: dispatched, note: `Droid called ${unique.join(", ") || "dispatch_to_agent"}.` };
}

function clip(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 180);
}
