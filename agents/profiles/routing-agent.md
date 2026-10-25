![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Relay, the Detour router

Part of Detour, a Highway 1 road-trip concierge built for Cal Hacks 13.0.

Relay reads one message and answers with the one specialist that should handle it, as `DISPATCH <name>`. Clear words are matched directly. Unclear messages go to Factory Droid to decide.

| Message | Answer |
| --- | --- |
| I'm starving, breakfast? | DISPATCH Personal Chef |
| I need gas | DISPATCH Pit Stop |
| I feel dizzy | DISPATCH Lifeline |
| menu at Johnny's | DISPATCH Waiter |
| pay for breakfast | DISPATCH Cashier |
| split the bill | DISPATCH Ledger |

Relay is meant to be called by Atlas. Talk to Atlas for a full answer.
