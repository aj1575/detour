"""End-to-end check of the demo flow without ASI:One.

Runs every Detour agent plus two tester agents (the trip lead and a friend) in one process.
Testers talk to Yatra through uAgents' local dispatch, exactly as ASI:One would,
and the script prints every reply, including card summaries.

Stop agents/trip_captain.py first, because this uses the same ports. The web app must be running.

    .venv\\Scripts\\python.exe agents\\tests\\flow_check.py [--pay]

--pay also approves a Stripe test payment, which records a real Splitwise expense.
"""

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crew  # noqa: E402  (sets the event loop and builds the agents)
from uagents import Agent, Context, Protocol  # noqa: E402
from uagents_core.contrib.protocols.chat import (  # noqa: E402
    ChatAcknowledgement,
    ChatMessage,
    MetadataContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.chat.cards import create_card_response_content, extract_card  # noqa: E402

PAY = "--pay" in sys.argv
inbox: dict[str, asyncio.Queue] = {}
failures: list[str] = []


def tester(name: str, port: int) -> Agent:
    agent = Agent(name=name, seed=f"detour flow check {name} {time.time()}", port=port, network="testnet")
    proto = Protocol(spec=chat_protocol_spec)

    @proto.on_message(ChatMessage)
    async def got(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
        await inbox[name].put(msg)

    @proto.on_message(ChatAcknowledgement)
    async def ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(proto)
    inbox[name] = asyncio.Queue()
    return agent


lead = tester("lead", 8021)
friend = tester("friend", 8022)


def describe(msg: ChatMessage) -> tuple[str, dict | None]:
    text = " ".join(item.text for item in msg.content if isinstance(item, TextContent))
    card = None
    for item in msg.content:
        if isinstance(item, MetadataContent):
            found = extract_card(item)
            if found is not None:
                card = json.loads(found.payload.model_dump_json(exclude_none=True))
            elif item.metadata.get("card_payload"):
                card = json.loads(item.metadata["card_payload"])
    return text, card


def card_line(card: dict) -> str:
    if "items" in card:
        return f"[carousel '{card.get('title')}': " + "; ".join(
            f"{item['title']} -> {item['primary_cta']['selection']}" for item in card["items"]
        ) + "]"
    if "approve_cta" in card:
        return f"[review '{card['title']}': " + ", ".join(f"{r['label']}={r['value']}" for r in card["summary_rows"]) + "]"
    root = card.get("root", {})
    return f"[custom '{root.get('title')}' {len(json.dumps(card))} bytes]"


async def say(who: Agent, text: str | None = None, selection: dict | None = None, wait: float = 60,
              expect: str = "", replies: int = 1) -> list[tuple[str, dict | None]]:
    queue = inbox[who.name]
    while not queue.empty():
        queue.get_nowait()
    content = [TextContent(text=text)] if text is not None else [create_card_response_content(selection=selection)]
    label = text if text is not None else f"<tap {selection}>"
    print(f"\n>>> {who.name}: {label}", flush=True)
    started = time.time()
    await lead_ctx[who.name].send(crew.captain.address, ChatMessage(content=content))
    got = []
    deadline = started + wait
    while len(got) < replies and time.time() < deadline:
        try:
            msg = await asyncio.wait_for(queue.get(), timeout=max(0.1, deadline - time.time()))
        except asyncio.TimeoutError:
            break
        text_out, card = describe(msg)
        got.append((text_out, card))
        print(f"<<< ({time.time() - started:.1f}s) {text_out[:700]}", flush=True)
        if card:
            print(f"    {card_line(card)}", flush=True)
    if not got:
        print(f"!!! no reply within {wait:.0f}s", flush=True)
        failures.append(f"{label}: no reply")
    elif expect and not any(expect.lower() in (t + json.dumps(c or {})).lower() for t, c in got):
        print(f"!!! expected '{expect}'", flush=True)
        failures.append(f"{label}: expected '{expect}'")
    return got


lead_ctx: dict[str, Context] = {}


@lead.on_event("startup")
async def keep_lead(ctx: Context):
    lead_ctx["lead"] = ctx


@friend.on_event("startup")
async def keep_friend(ctx: Context):
    lead_ctx["friend"] = ctx


def first_option(got, action: str) -> dict | None:
    for _, card in got:
        for item in (card or {}).get("items", []):
            if item["primary_cta"]["selection"].get("action") == action:
                return item["primary_cta"]["selection"]
    return None


def option_at(got, index: int) -> dict | None:
    for _, card in got:
        items = (card or {}).get("items", [])
        if len(items) > index:
            return items[index]["primary_cta"]["selection"]
    return None


async def script():
    while len(lead_ctx) < 2:
        await asyncio.sleep(0.5)
    await asyncio.sleep(3)

    # The boarding pass's Start my trip button opens onboarding straight away.
    await say(lead, selection={"action": "start_trip"}, expect="that's great")

    # Trip onboarding through the boarding pass card.
    await say(lead, "@yatra Let's plan a trip", expect="BOARDING PASS")
    await say(lead, selection={"content_id": "big_sur_drive", "category": "coastal_drive", "destination": "Big Sur"},
              expect="What dates")
    await say(lead, "Nov 7 to Nov 9", expect="starting from")
    await say(lead, "plan a trip", expect="BOARDING PASS")  # the old bug saved this as the starting city
    await say(lead, "from San Jose with Jordan and Priya", expect="we're all in")
    await say(friend, "we're all in", expect="let's go")

    # Group decisions: stays and things to do, voted by two people.
    stays_got = await say(lead, "where should we stay?", wait=90, expect="Vote for this")
    if pick := option_at(stays_got, 0):
        await say(lead, selection=pick, expect="Vote counted")
        await say(lead, selection=pick, expect="already handled")  # a double tap runs once
        await say(friend, selection=pick, expect="(2)")
    if pick := option_at(stays_got, 1):
        await say(friend, selection=pick, expect="changed your vote")
    await say(friend, "what fun things can we do there?", wait=90, expect="Vote for this")
    await say(lead, "plan our days", wait=150, expect="Your trip plan")

    # On the road.
    food = await say(lead, "I'm starving, breakfast?", wait=90, expect="See menu")
    menu = await say(lead, selection=first_option(food, "menu") or {"action": "menu", "place": "Johnny's"},
                     wait=60, expect="Sample menu")
    if dish := first_option(menu, "order"):
        await say(lead, selection=dish, expect="Added")
    await say(lead, "pay", wait=60, expect="Approve")
    if PAY:
        await say(lead, selection={"action": "pay"}, wait=90, expect="Stripe test payment")
        await say(lead, "split the bill", wait=60, expect="Splitwise")
    await say(friend, "the tank is almost empty", wait=90, expect="mi")
    await say(lead, "I feel dizzy", wait=60, expect="911")
    await say(lead, "thanks, the view is amazing", wait=60)

    # A restart forgets the in-memory trip. Convex brings it back.
    crew.crews.clear()
    crew.chats.clear()
    await say(friend, "where can we camp near there?", wait=90, expect="Big Sur")
    await say(lead, "verify agents", wait=30, expect="every signature is valid")

    print("\n==== RESULT ====")
    print("all checks passed" if not failures else "\n".join(f"FAIL {item}" for item in failures), flush=True)
    os_exit(0 if not failures else 1)


def os_exit(code: int):
    import os

    os._exit(code)


@lead.on_event("startup")
async def start_script(ctx: Context):
    asyncio.get_event_loop().create_task(script())


async def main():
    await asyncio.gather(*(agent.run_async() for agent in (*crew.AGENTS, lead, friend)))


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
