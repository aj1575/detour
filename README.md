# Detour

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Detour is a road-trip concierge for two people driving Highway 1 from San Francisco toward Big Sur. One message picks one specialist: breakfast, gas, urgent care, a sample menu, a Stripe test payment, or a Splitwise split.

Built for Cal Hacks 13.0 with Fetch.ai. The agents use the Agent Chat Protocol, register on Agentverse with mailboxes, and are called from ASI:One.

## Call the agents

In ASI:One, open the chat model menu. If Claude is selected, switch it to **asi1**, then message the trip captain. Claude answers on its own and does not call these agents. `asi1-mini` is the fast lightweight model, and `asi1-ultra` is the slower, heavier one. Use **asi1**.

`agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc`

The trip captain is the starter. It sends each message to Droid. Droid reads the intent and names exactly one specialist. The captain then calls that specialist, and the reply comes back in the same chat.

| Say this | Agent |
| --- | --- |
| `I'm starving, breakfast?` | Personal Chef |
| `I need gas` | Pit Stop |
| `I feel dizzy` | Lifeline |
| `menu at Johnny's` | Waiter, with a menu card |
| `pay` | Cashier. Approve the card, then finish the Stripe test checkout |
| `split the bill` | Ledger |

The local app and the Python process both have to be running. The website is at http://localhost:3000.

## Agents

| Name | Handle | Role | Address |
| --- | --- | --- | --- |
| Atlas | `@atlas-guide` | Trip captain | `agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc` |
| Relay | `@routing-agent` | Droid router | `agent1qte8wqjqant2k8u8k57k0nmsx9qjtp9f3la2y3y5nxs5cqg0qqafvlqh7wm` |
| BiteScout | `@food-agent` | Breakfast | `agent1qwfx0n64pf2xqqm9ttdevyyqtnnug6ggz7kee52gyjurwysgklvh6dh3n9x` |
| FuelFox | `@fuel-stop-agent` | Gas | `agent1qdtmn2vscx5ueajpx47gsg2nhp2pe54px2564r64e0w4n8mttuyn5mt8fup` |
| CareRoute | `@urgent-care-agent` | Urgent care | `agent1qdnp5dyudvdkrwqdflam38farm7c6kn6ktjfelfqvlfd3r8sevhayx7cklf` |
| MenuScout | `@menu-agent` | Sample menu and orders | `agent1qfapfp27kvvwdw0l4tqh800eyfl2kda5ehrmzehjm35f3gr6vx00vm405j9` |
| PayPilot | `@payment-agent` | Fetch Payment Protocol, Stripe test | `agent1q0962tw9y90a8qr7th2zljmch7hn8edxj7ckxqnl6m7cyn9zmlygwz6v7ym` |
| Ledger | `@expense-agent` | Splitwise split | `agent1q204lpkkqnr896m8qc2tssasxmsfjgmju84ynlcj5gshzc44chezssn6gpy` |

Each agent's Agentverse profile lives in the repo: the description and starter prompts in `ROSTER` in `agents/crew.py`, and the README in `agents/profiles/<handle>.md`. With `AGENTVERSE_API_KEY` in `.env`, every start pushes them to Agentverse. Without it, they are pushed when you choose **Connect → Mailbox** in the inspector.

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

The script prints an inspector link for each agent. Open each link and choose **Connect**, then **Mailbox**. Leave that process running. `mailbox=True` is already set. Do not add an `endpoint=` line. An endpoint replaces the mailbox.

Copy `.env.example` to `.env` and to `web/.env`. Fill in the keys you use. Never commit those files.

| Key | Used for |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Places and the Highway 1 route |
| `FACTORY_API_KEY` | Droid, when a message is ambiguous |
| `APIFY_TOKEN` | Review buzz from `route-buzz-finder` |
| `STRIPE_SECRET_KEY` | Test payments only. The key must start with `sk_test_` |
| `SPLITWISE_API_KEY` | The split after a test payment |
| `CARTESIA_API_KEY` | Spoken replies in the web app |
| `AGENTVERSE_API_KEY` | Optional. Pushes each agent's profile to Agentverse on start |

`ASI1_API_KEY` is not required for receiving a chat from ASI:One.

## What each piece does

The trip is Alex, the trip lead, and Jordan, the driver. The route comes from the Google Routes API and is kept only if it stays on the coast through Pescadero and Carmel. Stops come from Google Places near that route. The Apify actor `route-buzz-finder` adds a review-buzz label. If Places fails, the Apify Google Places crawler is the fallback.

The menu is a labeled sample. The restaurant did not send this. In ASI:One, breakfast stops and the menu arrive as interactive cards. Approving the payment card asks the cashier to open a Stripe test checkout through the Fetch Payment Protocol. The reliable place to finish that card form is the Agentverse inspector for the cashier. The website button still runs a direct Stripe test charge. Ledger records the Splitwise expense after the protocol payment is verified. A blank email for Jordan puts the expense on the signed-in Splitwise user only.

Medical replies start with: if this is an emergency, call 911.
