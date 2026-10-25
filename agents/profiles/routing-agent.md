![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Relay, the Travel Assist AI router

Part of Travel Assist AI, a group travel concierge built for Cal Hacks 13.0.

Relay reads one message and answers with the one specialist that should handle it, as `DISPATCH <name>`. Factory Droid judges every message except obvious medical ones and fixed card commands. Droid must pick one label from a fixed list and give a short reason. Medical always wins. Trip planning goes back to Atlas as `DISPATCH Trip`.

| Message | Answer |
| --- | --- |
| I'm starving, breakfast? | DISPATCH Personal Chef |
| I need gas | DISPATCH Pit Stop |
| I feel dizzy | DISPATCH Lifeline |
| menu at Johnny's | DISPATCH Waiter |
| pay for breakfast | DISPATCH Cashier |
| split the bill | DISPATCH Ledger |
| where should we stay? | DISPATCH Stays |
| things to do in Big Sur | DISPATCH Guide |
| plan our days | DISPATCH Planner |
| road trip from San Jose to Big Sur | DISPATCH Trip |

Relay is meant to be called by Atlas. Talk to Atlas for a full answer.
