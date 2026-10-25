![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Atlas

Travel Assist AI is a group travel concierge built for Cal Hacks 13.0. Plan a road trip with your friends in one ASI:One chat, vote on where to stay and what to do, get a day-by-day plan, and get help on the road.

Atlas is the agent you talk to, and it stays in charge of the conversation. Start by telling it about your trip. It asks where you're going, when, and who's coming, then shows you how to bring your friends into the chat. Every friend who messages it joins the same trip. It sends each request to Relay, where Factory Droid picks one specialist, and brings the answer back here.

## Start a trip

Say "Let's plan a trip" to get the Explore the Area card. Tap Santa Cruz, San Francisco, or Big Sur, then tell Atlas your dates.

Or say: road trip from San Jose to Big Sur with Jordan and Priya

To bring your friends in, ask your ASI:One AI "Add Jordan and Priya to this chat", or share this chat's invite link. Say "we're all in" when everyone is here.

## Plan together

| Say | Who answers |
| --- | --- |
| where should we stay? | StayScout: places near your destination, as a card everyone votes on |
| things to do there | Local Guide: sights and hikes, as a card everyone votes on |
| plan our days | Itinerary: a day-by-day plan from real places and the group's votes |
| (share photos with Atlas) | Atlas adds them to the trip album |
| curate a post | Curator: the photos that look best together, with a caption and hashtags |

## On the road

| Say | Who answers |
| --- | --- |
| we're in Monterey now | Remembers where you are for the next search |
| I'm starving, breakfast? | BiteScout: places to eat as cards with See menu |
| We're low on gas | FuelFox: gas stations |
| I feel dizzy | CareRoute: urgent care, starting with a 911 reminder |
| menu at Johnny's | MenuScout: a sample menu card |
| pay | PayPilot: approval card, then a Stripe test payment |
| split the bill | Ledger: the Splitwise split |

## Notes

The trip, votes, and plan are stored in Convex, so they survive a restart and show live on the Travel Assist AI trip board. Places come from Google Places. Menus are samples, not from the restaurant. Payments are Stripe test mode only.
