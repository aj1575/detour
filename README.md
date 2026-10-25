# Detour

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Detour is a group travel concierge that lives in an ASI:One group chat. Friends plan the trip together: where to go, when, who's coming, where to stay, and what to do. Everyone votes on stays and activities, and Detour turns the winners into a day-by-day itinerary. On the road it handles breakfast, gas, urgent care, the group's food order, a Stripe test payment, and the Splitwise split. The driver keeps their hands on the wheel.

Built for Cal Hacks 13.0 by Yuktaa and Anurag. The agent you talk to is **Atlas** (`@atlas-guide`), the trip captain. Twelve agents use the Agent Chat Protocol, register on Agentverse with mailboxes, and are called from ASI:One. Convex is the shared live memory, and a live trip board shows everyone the same trip in real time.

## How we use Convex

- Shared memory for twelve stateless agents: one trip per ASI:One group chat, and every action claimed once by key.
- Live board with `useQuery` everywhere: votes, itinerary, album, posts, and agent ID cards update without a refresh.
- Components: Presence (who's viewing) and Rate Limiter (votes and photo uploads).
- File storage for the trip album, a scheduled function and a cron that forget shared locations after six hours.
- Details, with the file behind each feature: [hackathon.md](hackathon.md).

## Call the agents

In ASI:One, open the chat model menu. If Claude is selected, switch it to **asi1**, then message Atlas. Claude answers on its own and does not call these agents. `asi1-mini` is the fast lightweight model, and `asi1-ultra` is the slower, heavier one. Use **asi1**.

`agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc`

The demo, in order:

| Say this | What happens |
| --- | --- |
| `Let's plan a trip` | Atlas shows the Detour boarding pass card. Tap a gate such as Big Sur, then give your dates. Or tap **Start my trip** |
| `from San Jose with Jordan and Priya` | Atlas explains how to bring them into the chat |
| `we're all in` (from a friend) | Atlas welcomes the group. The friend joins the same trip |
| `where should we stay?` | StayScout sends a card of places near the destination. Everyone taps **Vote for this** |
| `things to do there` | Local Guide sends a voting card of sights and hikes |
| `plan our days` | Itinerary builds a day-by-day plan from real places and the group's votes |
| `we're in Monterey now`, then `I'm starving, breakfast?` | BiteScout, ranked by distance, with See menu |
| Tap **See menu**, then **Add to order** | MenuScout adds the dish to the group order |
| `pay`, then **Approve** | PayPilot runs a Stripe test payment, and Ledger splits it in Splitwise |
| `the tank is almost empty` | FuelFox |
| `I feel dizzy` | CareRoute, always starting with the 911 line |
| Share photos with `@atlas-guide` along the way | Atlas adds them to the trip album, stored in Convex |
| `curate a post` | Curator picks the photos that look best together and writes a caption. **Another set** gives a different post |
| `verify agents` | Atlas checks every agent's signed actions and shows their ID cards |

Atlas is the one agent you talk to, and it stays in charge. Each request goes to Relay, where Factory Droid judges it with structured output: one label from a fixed list, any place the person names, and a short reason. Only two kinds of message skip Droid: obvious medical messages, so they are never delayed, and the fixed commands that card buttons send. Atlas then calls that specialist, and the reply comes back in the same chat.

Open http://localhost:3000 to watch the **live trip board**. Its message box and **Reply by voice** button reach the same concierge: stays, things to do, the itinerary, food, gas, and urgent care, using the group's trip. Driving mode reads each answer aloud with Cartesia. It shows the itinerary, the vote tallies, who is looking at the board, the group order, and every agent's work, all updating the moment anyone in the chat acts.

## Agents

| Name (Agentverse profile) | Handle | Role | Address |
| --- | --- | --- | --- |
| [Atlas](https://agentverse.ai/agents/details/agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc/profile) | `@atlas-guide` | Starter, trip onboarding, votes | `agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc` |
| [Relay](https://agentverse.ai/agents/details/agent1qte8wqjqant2k8u8k57k0nmsx9qjtp9f3la2y3y5nxs5cqg0qqafvlqh7wm/profile) | `@routing-agent` | Droid router | `agent1qte8wqjqant2k8u8k57k0nmsx9qjtp9f3la2y3y5nxs5cqg0qqafvlqh7wm` |
| [StayScout](https://agentverse.ai/agents/details/agent1q2qzfn40z7g4k22pg38q7ap4407xuvfhpat4jcn20x4lxl6ky9m9uf0pref/profile) | `@detour-stays` | Places to stay, voting card | `agent1q2qzfn40z7g4k22pg38q7ap4407xuvfhpat4jcn20x4lxl6ky9m9uf0pref` |
| [Local Guide](https://agentverse.ai/agents/details/agent1qfus9aqzdmgy50rgvcuf0tq56qq0xm0gsg66hgmk54z20vkwrrvuknggchw/profile) | `@detour-guide` | Things to do, voting card | `agent1qfus9aqzdmgy50rgvcuf0tq56qq0xm0gsg66hgmk54z20vkwrrvuknggchw` |
| [Itinerary](https://agentverse.ai/agents/details/agent1qfs44alz3vhg4s2npexnychrq3nyyeyxvqektj97spqlnx3sg5rj2mjxmhz/profile) | `@detour-planner` | Day-by-day plan with Droid | `agent1qfs44alz3vhg4s2npexnychrq3nyyeyxvqektj97spqlnx3sg5rj2mjxmhz` |
| [Curator](https://agentverse.ai/agents/details/agent1qgyzvjh6xxq9ejgsjk9x20fqvjxuqljlxq5cs6f5jpqhf9vxxzntz693x8a/profile) | `@detour-curator` | Photo post and caption | `agent1qgyzvjh6xxq9ejgsjk9x20fqvjxuqljlxq5cs6f5jpqhf9vxxzntz693x8a` |
| [BiteScout](https://agentverse.ai/agents/details/agent1qwfx0n64pf2xqqm9ttdevyyqtnnug6ggz7kee52gyjurwysgklvh6dh3n9x/profile) | `@food-agent` | Breakfast | `agent1qwfx0n64pf2xqqm9ttdevyyqtnnug6ggz7kee52gyjurwysgklvh6dh3n9x` |
| [FuelFox](https://agentverse.ai/agents/details/agent1qdtmn2vscx5ueajpx47gsg2nhp2pe54px2564r64e0w4n8mttuyn5mt8fup/profile) | `@fuel-stop-agent` | Gas | `agent1qdtmn2vscx5ueajpx47gsg2nhp2pe54px2564r64e0w4n8mttuyn5mt8fup` |
| [CareRoute](https://agentverse.ai/agents/details/agent1qdnp5dyudvdkrwqdflam38farm7c6kn6ktjfelfqvlfd3r8sevhayx7cklf/profile) | `@urgent-care-agent` | Urgent care | `agent1qdnp5dyudvdkrwqdflam38farm7c6kn6ktjfelfqvlfd3r8sevhayx7cklf` |
| [MenuScout](https://agentverse.ai/agents/details/agent1qfapfp27kvvwdw0l4tqh800eyfl2kda5ehrmzehjm35f3gr6vx00vm405j9/profile) | `@menu-agent` | Sample menu and orders | `agent1qfapfp27kvvwdw0l4tqh800eyfl2kda5ehrmzehjm35f3gr6vx00vm405j9` |
| [PayPilot](https://agentverse.ai/agents/details/agent1q0962tw9y90a8qr7th2zljmch7hn8edxj7ckxqnl6m7cyn9zmlygwz6v7ym/profile) | `@payment-agent` | Fetch Payment Protocol, Stripe test | `agent1q0962tw9y90a8qr7th2zljmch7hn8edxj7ckxqnl6m7cyn9zmlygwz6v7ym` |
| [Ledger](https://agentverse.ai/agents/details/agent1q204lpkkqnr896m8qc2tssasxmsfjgmju84ynlcj5gshzc44chezssn6gpy/profile) | `@expense-agent` | Splitwise split | `agent1q204lpkkqnr896m8qc2tssasxmsfjgmju84ynlcj5gshzc44chezssn6gpy` |

Each agent's Agentverse profile lives in the repo: the description and starter prompts in `ROSTER` in `agents/crew.py`, and the README in `agents/profiles/<handle>.md`. Test suites are in `agents/tests/`.

## How it uses each sponsor

**Fetch.ai.** Twelve uAgents with the Agent Chat Protocol and mailboxes on Agentverse. The whole flow runs inside one ASI:One conversation. That includes group chats: each friend who messages Atlas joins the same trip. It uses Interactive Cards (a custom boarding pass card, voting carousels, a custom itinerary card, a menu carousel, and a payment review card) and the Fetch Payment Protocol, verified against Stripe before it completes.

**Convex.** Convex is the agents' shared memory and the board's live backend:
- Atlas's trip state (stage, route, dates, people, chat members) is stored in Convex. A restart of the agents loses nothing, and every friend in the group chat resolves to the same trip (`convex/trips.ts`).
- Votes are one-per-person transactional mutations. The board's tallies are live queries (`convex/options.ts`).
- The board uses `useQuery` subscriptions for the trip, itinerary, messages, orders, votes, and agent log. There is no polling.
- The **Presence component** (`@convex-dev/presence`) shows who has the board open right now.
- A **cron** forgets shared locations after six hours (`convex/crons.ts`).
- **File storage** holds the trip album. Each photo is resized and measured on upload, and its public Convex URL is what the Curator's card shows in ASI:One (`convex/photos.ts`).

**Agent ID cards and a signed action log.**
- On startup, each agent publishes an ID card to Convex: name, handle, Fetch address, role, and protocols.
- Every action an agent takes gets an idempotency key and is signed with the agent's own key (`sign_action` in `agents/crew.py`).
- If the same message arrives twice, or someone double-taps a card button such as a vote or Approve, it runs once. The Captain says the tap was already handled, and the board counts the repeats it blocked.
- Say `verify agents` in ASI:One. The Captain re-checks every recent signature against each agent's address and replies with an ID-card card. Changing a row in Convex after it was signed makes that action fail the check.
- The board shows all twelve ID cards and the signed action log live.

**Factory Droid.** The Droid SDK does three jobs with structured output (`web/lib/droid.ts`, `web/lib/itinerary.ts`). It routes every unclear message to one of ten intents, it writes the day-by-day itinerary as typed JSON, using only real places from Google Places and the group's votes, and it writes the caption and hashtags for the Curator's photo posts.

**Bringing people closer together.** The trip album turns everyone's photos into one shared story: the Curator picks the set that looks best together (same color mood, sharp, well exposed) and captions it for the group. Planning a trip with friends usually means a messy group chat and one person doing all the work. In Detour the whole group plans in one chat: anyone can ask, everyone votes, the tally is shared, and the plan reflects the group's choices. The board shows who is there with you.

**Microsoft: built for the real world.** We address each of the five capabilities Microsoft asked for:
1. **Customer understanding.** The customer is a group of friends planning a trip, with one driver who can't look at a phone. Today they plan in a messy group chat where one person does all the work. Detour keeps planning in that chat, lets everyone take part by voting, and keeps the driver hands-free with voice replies and a 911-first medical path.
2. **Measurable usefulness.** Every agent action is logged with its duration, so the board shows each agent's median reply time, errors, and repeated deliveries blocked. In our end-to-end test (`agents/tests/flow_check.py`, 25 checks), a group of two went from "Let's plan a trip" to a voted stay and a three-day itinerary in 10 messages or taps and about 100 seconds of agent time. About 60 of those seconds are Droid writing the itinerary.
3. **Path from prototype to production.**
   - State already lives in a managed backend (Convex), and the agents are stateless and restartable.
   - Each piece has a production swap: Stripe test mode to live keys behind the same approval card, sample menus to a restaurant or POS API, `localhost` to a hosted Next.js app with `DETOUR_PUBLIC_URL`, and the local agent process to Agentverse-hosted or containerised agents.
4. **Responsible design.**
   - Medical replies always start with the 911 line, and medical messages skip the model so they are never delayed.
   - Payments need an explicit Approve, and run in test mode only.
   - A shared location is deleted after six hours by a cron.
   - Every action is signed by the agent that took it and can be audited ("verify agents"), and double taps can't charge or vote twice.
   - Menus are labelled as samples.
5. **End-to-end functionality.**
   - The whole journey runs in ASI:One: onboarding, group voting, the itinerary, food, the order, payment, and the split.
   - It is covered by an automated end-to-end test that runs every agent plus two simulated people.
   - It is also covered by `agents/tests/asi1_check.py`, which drives Atlas through the ASI:One API itself.

**Reliability details.**
- Trip state is durable.
- A failed Droid call falls back to a keyword classifier, and a failed itinerary falls back to a plan built from the same real places.
- Google Places has an Apify fallback, and review buzz never delays results more than four seconds.
- The agents retry once when the web app is unreachable. A slow call is never retried, so a payment never runs twice.
- Users see plain-language errors instead of stack traces.
- Medical replies always start with the 911 line, shared locations expire, and payments are test-mode only, behind an approval card.
- `agents/tests/flow_check.py` runs the whole demo end to end without ASI:One.

**Apify.** The custom actor `route-buzz-finder` (actor id `intellectual_pepper~route-buzz-finder`, source in `actor/`) adds review buzz to places. The Apify Google Places crawler is the fallback when Google Places fails.

## Run it

From the repo root, in three terminals.

Convex, from `web/`. The app is already pointed at the Detour cloud deployment in `web/.env.local`. Leave `CONVEX_AGENT_MODE` unset.

```powershell
npx convex dev
```

Next.js, from `web/`:

```powershell
npm install
npm run dev
```

Agents, from the repo root. This machine blocks `Activate.ps1`, so call the venv Python directly:

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe agents\trip_captain.py
```

The script prints an inspector link for each agent. Open each link and choose **Connect**, then **Mailbox**. Leave that process running. `mailbox=True` is already set. Do not add an `endpoint=` line, because an endpoint replaces the mailbox.

To check the whole flow without ASI:One, stop the agents and run `.venv\Scripts\python.exe agents\tests\flow_check.py`. Add `--pay` to also approve a Stripe test payment, which records a real Splitwise expense.

Copy `.env.example` to `.env` and to `web/.env`, and fill in the keys you use. Never commit those files.

| Key | Used for |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Places and the Highway 1 route |
| `FACTORY_API_KEY` | Droid routing and the itinerary |
| `APIFY_TOKEN` | Review buzz from `route-buzz-finder` |
| `STRIPE_SECRET_KEY` | Test payments only. The key must start with `sk_test_` |
| `SPLITWISE_API_KEY` | The split after a test payment |
| `CARTESIA_API_KEY` | Spoken replies in the web app |
| `AGENTVERSE_API_KEY` | Optional. Pushes each agent's profile to Agentverse on start |
| `DETOUR_PUBLIC_URL` | Optional. A public URL for the trip board, which Atlas then shares in the chat |

`ASI1_API_KEY` is not required for receiving a chat from ASI:One.

## Known limitations

- ASI:One does not send the user's location to agents. Food, gas, and urgent care searches start from a place named in the message ("we're in Monterey now"), then a location shared at http://localhost:3000/here in the last six hours, then the trip's starting city. Stays and things to do search around the destination.
- The board follows the trip the group touched most recently. One active trip per deployment.
- The itinerary takes 30–60 seconds, because Droid writes it from real places.
- Menus are a labeled sample. Payments are Stripe test mode only, and the Stripe form may not render inside ASI:One. Approve runs a server-side test charge instead.

Medical replies start with: if this is an emergency, call 911.
