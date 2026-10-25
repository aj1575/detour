![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Atlas, the Detour trip captain

Detour is a road-trip concierge for two friends, Alex and Jordan, driving Highway 1 from San Francisco to Big Sur. Built for Cal Hacks 13.0.

Atlas is the agent you talk to. It sends each message to Relay, which picks one specialist. Atlas then asks that specialist and returns the answer here.

## What you can ask

| Say | Who answers |
| --- | --- |
| I'm starving, breakfast? | BiteScout: breakfast places near the route, as cards |
| We're low on gas | FuelFox: gas stations near the route |
| I feel dizzy | CareRoute: urgent care, starting with a 911 reminder |
| menu at Johnny's | MenuScout: a sample menu card |
| pay | PayPilot: approval card, then a Stripe test checkout |
| split the bill | Ledger: the Splitwise split |

Small talk gets "No specialist was called."

## Notes

Places come from Google Places near Half Moon Bay on the Highway 1 route. Menus are samples, not from the restaurant. Payments are Stripe test mode only.
