# Travel Assist AI

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

**AI agents for friends on a road trip.** The group plans together in one ASI:One chat. The driver keeps both hands on the wheel.

Friends decide where to go, when, who's coming, where to stay, and what to do. Everyone votes on stays and activities, and the winners become a day-by-day itinerary. On the road, the same chat handles breakfast, gas, urgent care, the group's food order, a Stripe test payment, and the Splitwise split.

Built for **Cal Hacks 13.0** by Anurag and Yuktaa.

- **Talk to:** Atlas, `@atlas-guide`, at `agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc`.
- **Agents:** 12 uAgents with the Agent Chat Protocol, registered on Agentverse with mailboxes.
- **Backend:** Convex, the agents' shared live memory.
- **Routing:** Factory Droid, with structured output.

## Contents

- [Try it](#try-it)
- [How it works](#how-it-works)
- [Agents](#agents)
- [Sponsor tech](#sponsor-tech)
- [Trust and safety](#trust-and-safety)
- [Run it locally](#run-it-locally)
- [Repository layout](#repository-layout)
- [Known limitations](#known-limitations)

## Try it

In [ASI:One](https://asi1.ai), set the chat model to **asi1**, then message `@atlas-guide`. If Claude is selected instead, it answers on its own and never calls these agents.

| Say this | What happens |
| --- | --- |
| `Let's plan a trip` | Atlas shows the trip card. Tap a destination such as Big Sur, or **Start my trip** |
| `Nov 14 to 16, from San Jose with Jordan and Priya` | Atlas saves the dates and route and explains how to bring friends into the chat |
| `we're all in` (from a friend) | The friend joins the same trip |
| `where should we stay?` | StayScout sends a voting card of places near the destination |
| `things to do there` | Local Guide sends a voting card of sights and hikes |
| `plan our days` | Itinerary builds a day-by-day plan from real places and the group's votes |
| `we're in Monterey now`, then `breakfast?` | BiteScout lists spots by distance, each with **See menu** |
| **See menu**, then **Add to order** (each person) | MenuScout collects everyone's pick into one group order |
| `pay`, then **Approve** | PayPilot runs a Stripe test payment, and Ledger splits it in Splitwise |
| `the tank is almost empty` | FuelFox finds the nearest gas |
| `I feel dizzy` | CareRoute starts with the 911 line, then nearby urgent care |
| Share photos with `@atlas-guide` | Atlas adds them to the shared trip album |
| `curate a post` | Curator picks the photos that look best together and writes a caption |
| `verify agents` | Atlas re-checks every agent's signed actions and shows their ID cards |

## How it works

```
ASI:One chat ──► Atlas (@atlas-guide) ──► Relay (Factory Droid picks one intent)
                    │                         │
                    │                         ▼
                    │        StayScout · Local Guide · Itinerary · Curator
                    │        BiteScout · MenuScout · FuelFox · CareRoute
                    │        PayPilot · Ledger
                    ▼
        Next.js API (web/app/api) ──► Convex (trips, votes, orders, photos, signed actions)
                                        ▲
                     Live trip board ───┘  (useQuery, localhost:3000)
```

- **Atlas** is the only agent people talk to, and it stays in charge of the conversation.
- **Relay** sends each unclear message to Factory Droid. Droid returns one label from a fixed list, any place the person names, and a short reason.
  - Two kinds of message skip Droid: obvious medical messages, so they are never delayed, and the fixed commands that card buttons send.
- Atlas calls the chosen specialist, and the reply comes back in the same chat as an Interactive Card.
- Every friend who messages Atlas in a group chat joins the same trip, stored in Convex.
- The **live trip board** at http://localhost:3000 shows the itinerary, vote tallies, the group order, the photo album, who is viewing, and every agent's work. All of it updates the moment anyone in the chat acts.
  - Driving mode reads each answer aloud with Cartesia.

## Agents

| Agent | Handle | Role |
| --- | --- | --- |
| [Atlas](https://agentverse.ai/agents/details/agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc/profile) | `@atlas-guide` | Trip captain: onboarding, votes, hand-offs |
| [Relay](https://agentverse.ai/agents/details/agent1qte8wqjqant2k8u8k57k0nmsx9qjtp9f3la2y3y5nxs5cqg0qqafvlqh7wm/profile) | `@routing-agent` | Droid router |
| [StayScout](https://agentverse.ai/agents/details/agent1q2qzfn40z7g4k22pg38q7ap4407xuvfhpat4jcn20x4lxl6ky9m9uf0pref/profile) | `@detour-stays` | Places to stay, voting card |
| [Local Guide](https://agentverse.ai/agents/details/agent1qfus9aqzdmgy50rgvcuf0tq56qq0xm0gsg66hgmk54z20vkwrrvuknggchw/profile) | `@detour-guide` | Things to do, voting card |
| [Itinerary](https://agentverse.ai/agents/details/agent1qfs44alz3vhg4s2npexnychrq3nyyeyxvqektj97spqlnx3sg5rj2mjxmhz/profile) | `@detour-planner` | Day-by-day plan written by Droid |
| [Curator](https://agentverse.ai/agents/details/agent1qgyzvjh6xxq9ejgsjk9x20fqvjxuqljlxq5cs6f5jpqhf9vxxzntz693x8a/profile) | `@detour-curator` | Photo post and caption |
| [BiteScout](https://agentverse.ai/agents/details/agent1qwfx0n64pf2xqqm9ttdevyyqtnnug6ggz7kee52gyjurwysgklvh6dh3n9x/profile) | `@food-agent` | Food nearby |
| [MenuScout](https://agentverse.ai/agents/details/agent1qfapfp27kvvwdw0l4tqh800eyfl2kda5ehrmzehjm35f3gr6vx00vm405j9/profile) | `@menu-agent` | Sample menu and the group order |
| [FuelFox](https://agentverse.ai/agents/details/agent1qdtmn2vscx5ueajpx47gsg2nhp2pe54px2564r64e0w4n8mttuyn5mt8fup/profile) | `@fuel-stop-agent` | Gas |
| [CareRoute](https://agentverse.ai/agents/details/agent1qdnp5dyudvdkrwqdflam38farm7c6kn6ktjfelfqvlfd3r8sevhayx7cklf/profile) | `@urgent-care-agent` | Urgent care, 911 first |
| [PayPilot](https://agentverse.ai/agents/details/agent1q0962tw9y90a8qr7th2zljmch7hn8edxj7ckxqnl6m7cyn9zmlygwz6v7ym/profile) | `@payment-agent` | Fetch Payment Protocol, Stripe test mode |
| [Ledger](https://agentverse.ai/agents/details/agent1q204lpkkqnr896m8qc2tssasxmsfjgmju84ynlcj5gshzc44chezssn6gpy/profile) | `@expense-agent` | Splitwise split |

Some handles still use the project's working name, `detour-`, because Agentverse handles are tied to the registered agents. All addresses are in [`agents/addresses.txt`](agents/addresses.txt).

Each agent's description and starter prompts are in `ROSTER` in `agents/crew.py`. Each agent's Agentverse README is in `agents/profiles/<handle>.md`, and its test suite is in `agents/tests/`.

## Sponsor tech

### Fetch.ai
- Twelve uAgents with the Agent Chat Protocol and Agentverse mailboxes. The whole journey runs inside one ASI:One conversation, group chats included.
- **Interactive Cards:**
  - a custom trip starter card;
  - voting carousels;
  - an itinerary card;
  - a per-person menu card;
  - the group order;
  - a payment review card.
- **Fetch Payment Protocol:** a payment is checked against Stripe before it completes.

### Convex
Convex is the agents' shared memory and the board's live backend. More detail, with the file behind each feature, is in [hackathon.md](hackathon.md).
- **Shared memory for stateless agents:**
  - Convex holds one trip per ASI:One chat: stage, route, dates, people, and members (`convex/trips.ts`).
  - Restarting the agents loses nothing.
- **Votes:** one-per-person transactional mutations, with live tallies (`convex/options.ts`).
- **Live board:** `useQuery` subscriptions everywhere, with no polling.
- **Components:**
  - [Presence](https://www.convex.dev/components/presence) shows who is viewing.
  - [Rate Limiter](https://www.convex.dev/components/rate-limiter) caps votes and photo uploads (`convex/limits.ts`).
- **File storage:** the trip album. Each photo's Convex URL is what the Curator's card shows in ASI:One (`convex/photos.ts`).
- **Privacy:** a scheduled function forgets a shared location six hours later, with a cron as backstop (`convex/crons.ts`).

### Factory Droid
The Droid SDK does three jobs with structured output (`web/lib/droid.ts`, `web/lib/itinerary.ts`, `web/lib/photos.ts`):
- routes every unclear message to one of ten intents;
- writes the day-by-day itinerary as typed JSON, using only real places from Google Places and the group's votes;
- writes captions and hashtags for the Curator's posts.

### Apify
- The custom actor `route-buzz-finder` adds review buzz to places. Its actor id is `intellectual_pepper~route-buzz-finder`, and its source is in `actor/`.
- The Apify Google Places crawler is the fallback when Google Places fails.

### Microsoft: built for the real world
1. **Customer understanding.** A group of friends planning a trip, with one driver who can't look at a phone.
   - Planning stays in the group chat they already use, everyone takes part by voting, and the driver gets voice replies.
2. **Measurable usefulness.** Every agent action is logged with its duration, and the board shows each agent's median reply time and errors.
   - In the end-to-end test, a group of two went from "Let's plan a trip" to a voted stay and a three-day itinerary in 10 messages and about 100 seconds of agent time.
3. **Path to production.** State already lives in a managed backend, and the agents are stateless. Each piece has a production swap:
   - Stripe test keys to live keys;
   - sample menus to a POS API;
   - localhost to a hosted Next.js app;
   - the local agent process to hosted agents.
4. **Responsible design.** See [Trust and safety](#trust-and-safety).
5. **End-to-end functionality.**
   - The whole journey runs in ASI:One.
   - `agents/tests/flow_check.py` covers it end to end.
   - `agents/tests/asi1_check.py` drives Atlas through the ASI:One API.

## Trust and safety

- **Medical:** replies always start with the 911 line, and medical messages skip the model, so they are never delayed.
- **Payments:**
  - Stripe test mode only, behind an explicit **Approve** card.
  - A double tap can't charge or vote twice: every action is claimed once by its idempotency key.
- **Signed actions:**
  - Each agent signs every action with its own key and publishes an ID card to Convex.
  - `verify agents` re-checks the signatures. Editing a signed row in Convex makes that action fail the check.
- **Location:** a shared location is deleted after six hours.
- **Fallbacks:**
  - If Droid fails, a keyword classifier routes the message. If the itinerary fails, Atlas builds a plan from the same real places.
  - Google Places falls back to Apify.
  - Users see plain-language errors instead of stack traces.

## Run it locally

Requirements: Python 3.11+, Node 20+, and a Convex account.

1. Copy `.env.example` to `.env` and to `web/.env`, and fill in the keys you use. Never commit either file.
2. Start Convex and the web app, each from `web/` in its own terminal:

   ```powershell
   npm install
   npx convex dev
   ```

   ```powershell
   npm run dev
   ```

3. Start the agents from the repo root:

   ```powershell
   python -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   .venv\Scripts\python.exe agents\trip_captain.py
   ```

   The script prints an inspector link for each agent. Open each one and choose **Connect**, then **Mailbox**. Do not add an `endpoint=`, because an endpoint replaces the mailbox.

4. Optional end-to-end test, with the agents stopped first: `.venv\Scripts\python.exe agents\tests\flow_check.py`. Add `--pay` to also approve a Stripe test payment.

| Key | Used for |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Places and routes |
| `FACTORY_API_KEY` | Droid routing, the itinerary, and captions |
| `APIFY_TOKEN` | Review buzz and the Places fallback |
| `STRIPE_SECRET_KEY` | Test payments only (`sk_test_…`) |
| `SPLITWISE_API_KEY` | The split after a payment |
| `CARTESIA_API_KEY` | Spoken replies on the board |
| `AGENTVERSE_API_KEY` | Optional. Pushes each agent's profile to Agentverse on start |
| `DETOUR_SEED_PREFIX` | Private part of every agent seed |
| `DETOUR_PUBLIC_URL` | Optional. A public URL for the board, which Atlas shares in chat |

## Repository layout

```
agents/
  crew.py            all 12 agents, their roster, and the chat logic
  trip_captain.py    starts every agent and registers its mailbox
  trip_agent.py      the trip starter card
  profiles/          Agentverse README for each agent
  tests/             end-to-end flow test, ASI:One check, Agentverse test CSVs
web/
  app/               Next.js trip board and the API the agents call
  components/        board UI
  convex/            schema, queries, mutations, crons, components
  lib/               Droid, Places, Stripe, Splitwise, photos
actor/               Apify actor route-buzz-finder
hackathon.md         Convex features and build log
```

## Known limitations

- ASI:One does not send a user's location to agents. Food, gas, and urgent care searches look for a location in this order:
  1. a place named in the message, such as "we're in Monterey now";
  2. a location shared at `/here` in the last six hours;
  3. the trip's starting city.
- The board follows the most recently active trip.
- The itinerary takes 30–60 seconds, because Droid writes it from real places.
- Menus are labelled samples, and payments are Stripe test mode only.

*If this is an emergency, call 911.*
