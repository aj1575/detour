# Hackathon log

- **Project:** Detour
- **Event:** Cal Hacks 13.0
- **What it does:** A team of Fetch.ai agents plans a group road trip inside one ASI:One chat, with votes, a day-by-day itinerary, a shared photo album, and help on the road, backed by Convex.
- **Live app:** not deployed (the agents run on Agentverse mailboxes and are reached from ASI:One; the trip board runs locally)
- **Repo:** https://github.com/aj1575/detour
- **Frontend:** not deployed
- **Convex deployment:** https://tacit-wildebeest-985.convex.cloud
- **Components:** @convex-dev/presence, @convex-dev/rate-limiter
- **Convex features:** schema, indexes, queries, mutations, internal mutations, crons, scheduled functions, file storage, realtime useQuery
- **Auth:** none
- **AI models:** none named in code (Factory Droid SDK with its default model)
- **Started:** 2026-10-25T01:08:22Z
- **Last updated:** 2026-10-25T08:10:15Z

## How we use Convex

- **Shared agent memory.** Twelve Python agents are stateless; Yatra's trip (stage, route, dates, people, chat members) lives in Convex, so every friend in an ASI:One group chat resolves to the same trip and a restart loses nothing. Mutations and indexes in `web/convex/trips.ts`.
- **Group voting.** Each Vote tap in ASI:One is one transactional mutation that replaces the voter's earlier vote and returns the tally; the Rate Limiter component caps votes per voter. `web/convex/options.ts`, `web/convex/limits.ts`.
- **Live trip board.** The board's chat, vote bars, itinerary, photo album, latest post, and agent ID cards all use `useQuery` and update live without a refresh; the Presence component shows who is viewing. `web/components/TripApp.tsx`, `web/convex/presence.ts`.
- **Trip album.** Photos shared in ASI:One are measured, saved with file storage, and served by their Convex URL in the Curator's post card; the Rate Limiter caps uploads per trip. `web/convex/photos.ts`.
- **Signed agent actions.** Every agent action is claimed once by key (so a double tap never runs twice) and stored with its signature and duration. `web/convex/actions.ts`.
- **Private by default.** A shared location is forgotten six hours later by a scheduled function, with a cron as the backstop. `web/convex/trips.ts`, `web/convex/crons.ts`.

## Log

- 2026-10-25 · `14f4e3f` · Agents, Convex schema, and the trip board: `agents/crew.py`, `web/convex/schema.ts`, `web/convex/trips.ts`, `web/components/TripApp.tsx`
- 2026-10-25 · `6ec75d1` · Yatra in group chats, voting, the itinerary, and signed actions: `agents/crew.py`, `agents/trip_agent.py`, `web/convex/options.ts`, `web/convex/actions.ts`, `web/lib/droid.ts`
- 2026-10-25 · `fca4b39` · Trip album and Curator agent with file storage: `web/convex/photos.ts`, `web/lib/photos.ts`, `web/app/api/curate/route.ts`
- 2026-10-25 · `7a8587f` · Rate Limiter component, scheduled location expiry, and a dates fix: `web/convex/limits.ts`, `web/convex/trips.ts`, `agents/crew.py`
