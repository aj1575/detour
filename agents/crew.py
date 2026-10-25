"""All Detour agents that register on Agentverse."""

import asyncio
import contextlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

asyncio.set_event_loop(asyncio.new_event_loop())

import httpx
from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents.mailbox import AgentverseConnectRequest, register_in_agentverse
from uagents_core.registration import AgentProfile, RegistrationRequest
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    MetadataContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.chat.cards import (
    CarouselCardPayload,
    CarouselItem,
    CtaAction,
    ReviewCardPayload,
    ReviewSummaryRow,
    create_card_content,
    extract_card_response,
)
from uagents_core.contrib.protocols.payment import (
    CancelPayment,
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

APP = os.getenv("DETOUR_APP_URL", "http://localhost:3000").rstrip("/")
AUTHOR = os.getenv("DETOUR_AUTHOR", "Alex")

SEED_PREFIX = os.getenv("DETOUR_SEED_PREFIX", "")
if not SEED_PREFIX:
    raise SystemExit("Set DETOUR_SEED_PREFIX in .env. It is the private part of every agent seed.")

PROFILES = Path(__file__).with_name("profiles")
AGENTVERSE_KEY = os.getenv("AGENTVERSE_API_KEY", "").strip()

ROSTER = (
    (
        "Atlas", "atlas-guide", "trip-captain", 8001,
        "Detour trip captain. Tell me about your road trip and who is coming, then message me on the way and "
        "I bring back the right specialist: breakfast, gas, urgent care, a menu, payment, or the bill split.",
        ["Let's go on a road trip", "I'm starving, breakfast?", "We're low on gas"],
    ),
    (
        "Relay", "routing-agent", "droid", 8002,
        "Detour router. Reads one road-trip message and names the one specialist that should handle it.",
        ["I need gas", "menu at Johnny's", "split the bill"],
    ),
    (
        "BiteScout", "food-agent", "personal-chef", 8003,
        "Finds breakfast restaurants near Half Moon Bay on Highway 1, with ratings and a See menu button.",
        ["breakfast", "I'm hungry, where should we eat?", "somewhere for breakfast on the way"],
    ),
    (
        "FuelFox", "fuel-stop-agent", "pit-stop", 8004,
        "Finds gas stations near Half Moon Bay on Highway 1, with ratings and phone numbers.",
        ["We're low on gas", "where can I get fuel?", "need to fill up the tank"],
    ),
    (
        "CareRoute", "urgent-care-agent", "lifeline", 8005,
        "Finds urgent care and clinics near Half Moon Bay on Highway 1. "
        "Always starts with: if this is an emergency, call 911.",
        ["I feel dizzy", "I hurt my ankle", "my friend is sick, nearest clinic?"],
    ),
    (
        "MenuScout", "menu-agent", "waiter", 8006,
        "Opens a sample breakfast menu for a stop and adds dishes to the group order.",
        ["menu at Johnny's", "show me the menu at Pilot Light", "order Coffee and pastry for Alex at Johnny's"],
    ),
    (
        "PayPilot", "payment-agent", "cashier", 8007,
        "Takes payment for the group's order through the Fetch Payment Protocol with a Stripe test checkout. "
        "It is not a real charge.",
        ["pay", "checkout please", "Alex and Jordan confirm pay"],
    ),
    (
        "Ledger", "expense-agent", "ledger", 8008,
        "Shows the Splitwise split for the trip after a payment.",
        ["split the bill", "who owes what?", "show the split"],
    ),
)


class ProfileAgent(Agent):
    def __init__(self, *, starter_prompts: list[str], **kwargs):
        super().__init__(**kwargs)
        self._starter_prompts = starter_prompts

    def _build_registration_profile(self) -> AgentProfile:
        profile = super()._build_registration_profile()
        return profile.model_copy(update={"starter_prompts": self._starter_prompts})


def make_agent(
    name: str, handle: str, seed: str, port: int, description: str, prompts: list[str]
) -> ProfileAgent:
    agent = ProfileAgent(
        name=name,
        handle=handle,
        seed=SEED_PREFIX + seed,
        port=port,
        mailbox=True,
        network="testnet",
        publish_agent_details=True,
        description=description,
        readme_path=str(PROFILES / f"{handle}.md"),
        starter_prompts=prompts,
    )

    @agent.on_event("startup")
    async def push_profile(ctx: Context):
        if not AGENTVERSE_KEY:
            return
        result = await register_in_agentverse(
            request=AgentverseConnectRequest(user_token=AGENTVERSE_KEY, agent_type="mailbox"),
            identity=agent._identity,
            prefix=agent._prefix,
            agentverse=agent._agentverse,
            agent_details=RegistrationRequest(
                address=agent.address,
                name=agent.name,
                handle=handle,
                profile=agent._build_registration_profile(),
                endpoints=agent._endpoints,
                protocols=list(agent.protocols.keys()),
                metadata=agent.metadata,
            ),
        )
        if not result.success:
            ctx.logger.warning("Agentverse profile was not updated: %s", result.detail)

    return agent


captain, droid, chef, pit, lifeline, waiter, cashier, ledger = (
    make_agent(*row) for row in ROSTER
)

NAMES = {
    "Droid": droid,
    "Personal Chef": chef,
    "Pit Stop": pit,
    "Lifeline": lifeline,
    "Waiter": waiter,
    "Cashier": cashier,
    "Ledger": ledger,
}
BY_ADDRESS = {agent.address: name for name, agent in NAMES.items()}
jobs: dict[str, dict[str, str]] = {}
checkouts: dict[str, dict[str, str]] = {}
TAG = re.compile(r"^#([0-9a-f]{8}) ")


def split_tag(text: str) -> tuple[str, str]:
    match = TAG.match(text)
    if not match:
        return "", text
    return match.group(1), text[match.end() :].strip()


def tagged(reply: "str | ChatMessage", tag: str) -> ChatMessage:
    if not isinstance(reply, ChatMessage):
        return outbound(f"#{tag} {reply}" if tag else str(reply), end=False)
    if not tag:
        return reply
    content = list(reply.content)
    for index, item in enumerate(content):
        if isinstance(item, TextContent):
            content[index] = TextContent(text=f"#{tag} {item.text}")
            break
    return ChatMessage(content=content)


def outbound(text: str, end: bool) -> ChatMessage:
    content: list[TextContent | EndSessionContent] = [TextContent(type="text", text=text[:1800])]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content)


def spoken(msg: ChatMessage) -> str:
    return " ".join(item.text for item in msg.content if isinstance(item, TextContent)).strip()


def clean(text: str) -> str:
    parts = text.split()
    if parts and parts[0].startswith("@agent"):
        return " ".join(parts[1:]).strip()
    return text.strip()


def card_command(selection: dict) -> str:
    action = str(selection.get("action") or "")
    if action == "menu" and selection.get("place"):
        return f"menu at {selection['place']}"
    if action == "order" and selection.get("item") and selection.get("place"):
        member = selection.get("member") or "Alex"
        return f"order {selection['item']} for {member} at {selection['place']}"
    if action == "pay":
        return "Alex and Jordan confirm pay"
    return ""


def incoming_text(msg: ChatMessage) -> str:
    for item in msg.content:
        if isinstance(item, MetadataContent):
            response = extract_card_response(item)
            if response is None:
                continue
            if response.cancelled:
                return ""
            if response.selection:
                return card_command(response.selection)
    return clean(msg.text())


def with_card(text: str, payload) -> ChatMessage:
    return ChatMessage(content=[TextContent(text=text[:1800]), create_card_content(payload)])


def forward(msg: ChatMessage, prefix: str, end: bool) -> ChatMessage:
    content = []
    named = False
    for item in msg.content:
        if isinstance(item, EndSessionContent):
            continue
        if isinstance(item, TextContent) and not named:
            content.append(TextContent(text=f"{prefix}: {split_tag(item.text)[1]}"[:1800]))
            named = True
        elif isinstance(item, (TextContent, MetadataContent)):
            content.append(item)
    if not named:
        content.insert(0, TextContent(text=prefix))
    interactive = any(
        isinstance(item, MetadataContent) and item.metadata.get("requires_card_interaction") == "true"
        for item in content
    )
    if end and not interactive:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(content=content)


def choose(text: str) -> str:
    lowered = text.lower()
    if any(word in lowered for word in ("dizzy", "hurt", "sick", "pain", "pharmacy", "hospital", "emergency")):
        return "Lifeline"
    if any(word in lowered for word in ("gas", "fuel")):
        return "Pit Stop"
    if any(word in lowered for word in ("pay", "charge", "checkout")):
        return "Cashier"
    if "split" in lowered:
        return "Ledger"
    if "menu" in lowered or lowered.startswith("order"):
        return "Waiter"
    if any(word in lowered for word in ("breakfast", "hungry", "starving", "food", "eat", "restaurant")):
        return "Personal Chef"
    if "trip" in lowered or re.search(r"\blet'?s go\b", lowered):
        return "Trip"
    return ""


async def post(path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=75) as client:
        response = await client.post(f"{APP}{path}", json=body)
        payload = response.json()
        if response.status_code >= 400:
            raise RuntimeError(payload.get("error") or f"{path} returned {response.status_code}")
        return payload


async def trip() -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{APP}/api/trip")
        response.raise_for_status()
        return response.json()


def attach(agent: Agent, work):
    protocol = Protocol(spec=chat_protocol_spec)

    @protocol.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
        tag, text = split_tag(clean(spoken(msg)))
        if not text:
            return
        try:
            reply = await work(text)
        except Exception as error:
            ctx.logger.exception("%s failed", agent.name)
            reply = str(error)
        await ctx.send(sender, tagged(reply, tag))

    @protocol.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        ctx.logger.info("Ack from %s", sender)

    agent.include(protocol, publish_manifest=True)


async def droid_work(text: str) -> str:
    picked = choose(text)
    if not picked:
        payload = await trip()
        plan = await post("/api/plan", {"tripId": payload["tripId"], "text": text})
        picked = plan.get("agent") or "none"
    if picked == "Trip":
        return "DISPATCH Trip"
    if picked not in NAMES or picked == "Droid":
        return "DISPATCH none"
    return f"DISPATCH {picked}"


async def search_work(agent_name: str, text: str) -> str | ChatMessage:
    payload = await trip()
    result = await post(
        "/api/specialist",
        {"tripId": payload["tripId"], "author": AUTHOR, "agent": agent_name, "text": text},
    )
    places = result.get("places") or []
    if agent_name != "Personal Chef" or not places:
        return result["reply"]
    items = [
        CarouselItem(
            id=f"stop-{index}",
            title=str(place.get("name") or "Breakfast stop")[:80],
            subtitle=(str(place.get("detail") or "")[:120] or None),
            secondary_text=(str(place.get("rating") or "")[:40] or None),
            primary_cta=CtaAction(
                label="See menu",
                selection={"action": "menu", "place": str(place.get("name") or "")},
                primary=True,
            ),
        )
        for index, place in enumerate(places[:5])
        if place.get("name")
    ]
    if not items:
        return result["reply"]
    return with_card(result["reply"], CarouselCardPayload(title="Breakfast on Highway 1", items=items))


def place_from(payload: dict) -> str:
    for message in reversed(payload.get("messages") or []):
        if message.get("menuJson"):
            menu = json.loads(message["menuJson"])
            if menu.get("placeName"):
                return menu["placeName"]
        if message.get("author") == "Personal Chef" and message.get("placesJson"):
            places = json.loads(message["placesJson"])
            if places:
                return places[0]["name"]
    return ""


def parse_order(text: str) -> tuple[str, str, str] | None:
    if not text.lower().startswith("order "):
        return None
    body = text[6:]
    for_at = body.lower().rfind(" for ")
    at_at = body.lower().rfind(" at ")
    if for_at < 0 or at_at < for_at:
        return None
    item = body[:for_at].strip()
    member = body[for_at + 5 : at_at].strip()
    place = body[at_at + 4 :].strip(" .")
    if not item or not member or not place:
        return None
    return item, member, place


async def waiter_work(text: str) -> str | ChatMessage:
    payload = await trip()
    ordered = parse_order(text)
    if ordered:
        item, member, place = ordered
        await post(
            "/api/order",
            {"tripId": payload["tripId"], "placeName": place, "member": member, "item": item},
        )
        return f"Added {item} for {member} at {place}. Say pay when the table is ready."
    place = place_from(payload)
    marker = " at "
    if marker in text.lower():
        place = text[text.lower().rfind(marker) + len(marker) :].strip(" .")
    if not place:
        return "Name the stop, for example: menu at Johnny's."
    result = await post("/api/menu", {"tripId": payload["tripId"], "placeName": place})
    dishes = result.get("dishes") or []
    items = [
        CarouselItem(
            id=f"dish-{index}",
            title=str(dish["name"])[:80],
            subtitle=(str(dish.get("note") or "")[:120] or None),
            secondary_text=f"${float(dish['price']):.2f}",
            primary_cta=CtaAction(
                label="Add for Alex",
                selection={"action": "order", "item": dish["name"], "member": "Alex", "place": place},
                primary=True,
            ),
        )
        for index, dish in enumerate(dishes)
    ]
    note = f"{result['note']} {place}."
    if not items:
        return note
    return with_card(note, CarouselCardPayload(title=place, subtitle="Sample menu", items=items))


async def cashier_turn(text: str) -> tuple[str | ChatMessage, RequestPayment | None]:
    payload = await trip()
    place = place_from(payload)
    if not place:
        return "Open a menu before paying.", None
    orders = [order for order in payload.get("orders") or [] if order.get("placeName") == place]
    cents = sum(round(float(order["price"]) * 100) for order in orders)
    if cents < 50:
        return "Add at least one item before paying.", None
    dollars = f"{cents / 100:.2f}"
    if "confirm" not in text.lower():
        card = ReviewCardPayload(
            title="Approve the test payment",
            summary_rows=[
                ReviewSummaryRow(label="Place", value=place),
                ReviewSummaryRow(label="Total", value=f"${dollars}"),
            ],
            approve_cta=CtaAction(label="Approve", selection={"action": "pay"}, primary=True),
            reject_cta=CtaAction(label="Not now", selection={"action": "skip"}),
        )
        return with_card(
            f"The sample order at {place} is ${dollars}. Approve it and Stripe test checkout opens.",
            card,
        ), None
    checkout = await post("/api/checkout", {"tripId": payload["tripId"], "placeName": place})
    session_id = checkout["checkoutSessionId"]
    checkouts[session_id] = {"tripId": payload["tripId"], "placeName": place}
    request = RequestPayment(
        accepted_funds=[Funds(amount=str(checkout["dollars"]), currency="USD", payment_method="stripe")],
        recipient=cashier.address,
        deadline_seconds=1800,
        description=str(checkout["description"]),
        reference=session_id,
        metadata={
            "stripe": {
                "ui_mode": "embedded",
                "publishable_key": str(checkout["publishableKey"]),
                "client_secret": str(checkout["clientSecret"]),
                "checkout_session_id": session_id,
                "currency": "usd",
                "amount_cents": str(checkout["amountCents"]),
            },
            "service": "detour_meal",
        },
    )
    note = (
        f"Stripe test checkout is open for ${checkout['dollars']} at {place}. "
        "Finish the card form, then approve the payment. Test card 4242 4242 4242 4242."
    )
    return note, request


async def ledger_work(text: str) -> str:
    payload = await trip()
    for message in reversed(payload.get("messages") or []):
        if message.get("author") in {"Ledger", "Cashier"}:
            return message["body"]
    return "No Splitwise expense has been recorded for this trip yet."


attach(droid, droid_work)
attach(chef, lambda text: search_work("Personal Chef", text))
attach(pit, lambda text: search_work("Pit Stop", text))
attach(lifeline, lambda text: search_work("Lifeline", text))
attach(waiter, waiter_work)
attach(ledger, ledger_work)

cashier_chat = Protocol(spec=chat_protocol_spec)


@cashier_chat.on_message(ChatMessage)
async def cashier_on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
    tag, text = split_tag(incoming_text(msg))
    if not text:
        return
    try:
        reply, payment = await cashier_turn(text)
    except Exception as error:
        ctx.logger.exception("cashier failed")
        reply, payment = str(error), None
    job = jobs.get(tag)
    buyer = job["user"] if job else sender
    if payment is not None:
        checkouts[payment.reference or ""]["user"] = buyer
        await ctx.send(buyer, payment)
    await ctx.send(sender, tagged(reply, tag))


@cashier_chat.on_message(ChatAcknowledgement)
async def cashier_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info("Ack from %s", sender)


cashier.include(cashier_chat, publish_manifest=True)

payments = Protocol(spec=payment_protocol_spec, role="seller")


@payments.on_message(CommitPayment)
async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
    session_id = msg.transaction_id or ""
    saved = checkouts.get(session_id)
    if msg.funds.payment_method != "stripe" or not session_id or saved is None:
        await ctx.send(
            sender,
            CancelPayment(transaction_id=session_id or None, reason="Unknown Stripe test checkout."),
        )
        return
    try:
        result = await post(
            "/api/checkout/complete",
            {
                "tripId": saved["tripId"],
                "placeName": saved["placeName"],
                "checkoutSessionId": session_id,
                "friendEmail": "",
            },
        )
    except Exception as error:
        ctx.logger.exception("checkout verify failed")
        await ctx.send(sender, CancelPayment(transaction_id=session_id, reason=str(error)[:300]))
        return
    await ctx.send(sender, CompletePayment(transaction_id=session_id))
    note = f"Cashier: Stripe test checkout is paid. {result.get('splitNote', '')}"
    await ctx.send(sender, outbound(note, end=True))


@payments.on_message(RejectPayment)
async def on_reject(ctx: Context, sender: str, msg: RejectPayment):
    await ctx.send(sender, outbound(msg.reason or "The payment was declined.", end=True))


cashier.include(payments, publish_manifest=True)

captain_protocol = Protocol(spec=chat_protocol_spec)

trips: dict[str, dict] = {}
READY = re.compile(r"\b(all in|all here|all set|every(one|body)'?s? (is )?(in|here)|we('?re| are) (all )?(in|here)|joined)\b")
SOLO = re.compile(r"\b(just me|only me|solo|alone|by myself)\b")
STOP = r"(?=\s+(?:with|along|on)\b|[,.?!]|$)"
WITH = re.compile(r"\bwith\s+(.+?)(?=\s+(?:from|to|along)\b|[.?!]|$)", re.I)
FROM_TO = re.compile(rf"\bfrom\s+(.+?)\s+to\s+(.+?){STOP}", re.I)
FROM = re.compile(rf"\bfrom\s+(.+?){STOP}", re.I)
X_TO_Y = re.compile(rf"^(.+?)\s+to\s+(.+?){STOP}", re.I)
NOT_NAMES = {"me", "i", "myself", "us", "friends", "my friends"}
SKILLS = (
    "- find breakfast on the way (BiteScout)\n"
    "- find gas when you're low (FuelFox)\n"
    "- find urgent care if someone feels unwell (CareRoute)\n"
    "- open a menu and take the group's order (MenuScout)\n"
    "- take payment with a Stripe test checkout (PayPilot)\n"
    "- split the bill in Splitwise (Ledger)"
)


def plain(text: str) -> str:
    return text.replace("\u2019", "'").strip()


def names_in(text: str) -> list[str]:
    names = []
    for part in re.split(r",|\band\b|&", text, flags=re.I):
        name = re.sub(r"^(my\s+)?(friends?|buddy|buddies)\s+", "", part.strip(" .!?"), flags=re.I).strip()
        if name and name.lower() not in NOT_NAMES:
            names.append(name[:1].upper() + name[1:])
    return names


def joined(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def place(text: str) -> str:
    text = text.strip()
    return text.title() if text.islower() else text


def read_trip(text: str, trip: dict, loose: bool):
    text = plain(text)
    rest = text
    if SOLO.search(text.lower()):
        trip["people"] = []
    elif match := WITH.search(text):
        trip["people"] = names_in(match.group(1))
        rest = (text[: match.start()] + text[match.end() :]).strip(" ,.")
    if match := FROM_TO.search(rest):
        trip["start"], trip["end"] = place(match.group(1)), place(match.group(2))
        return
    if match := FROM.search(rest):
        trip["start"] = place(match.group(1))
        return
    if not loose or not rest:
        return
    if "start" not in trip and (match := X_TO_Y.search(rest)):
        trip["start"], trip["end"] = place(match.group(1)), place(match.group(2))
    elif "start" in trip and "end" not in trip:
        trip["end"] = place(re.sub(r"^to\s+", "", rest, flags=re.I))
    elif "start" not in trip:
        trip["start"] = place(rest)
    elif "people" not in trip:
        trip["people"] = names_in(rest)


def trip_question(trip: dict) -> str:
    missing = []
    if "start" not in trip:
        missing.append("where you're starting from")
    if "end" not in trip:
        missing.append("where you're headed")
    if "people" not in trip:
        missing.append("who's coming with you")
    return (
        f"Road trip, love it. Tell me {joined(missing)}. "
        "For example: San Jose to Big Sur with Jordan and Priya."
    )


def trip_invite(trip: dict) -> str:
    names = joined(trip["people"])
    return (
        f"Got it: {trip['start']} to {trip['end']} with {names}.\n"
        "Bring them into this chat:\n"
        f"- If they're your ASI:One friends, tell your AI: Add {names} to this chat.\n"
        "- If not, tap Share at the top of this chat, copy the invite link, and send it to them. "
        "Turn on Public chat in chat settings so the link works.\n"
        "Say \"we're all in\" when everyone is here."
    )


def trip_welcome(trip: dict) -> str:
    people = trip.get("people") or []
    hello = f"Yay, let's go, {joined(people)}!" if people else "Yay, let's go!"
    route = f" from {trip['start']} to {trip['end']}" if trip.get("start") and trip.get("end") else ""
    return (
        f"{hello} I'll be your complete travel buddy{route} while your hands are on the wheel. "
        f"Mention me any time and I'll:\n{SKILLS}\nTry: I'm starving, breakfast?"
    )


async def plan_trip(ctx: Context, user: str, text: str, loose: bool):
    trip = trips.setdefault(user, {"stage": "details"})
    if trip["stage"] == "rolling":
        await ctx.send(user, outbound(trip_welcome(trip), end=False))
        return
    read_trip(text, trip, loose)
    if not {"start", "end", "people"} <= trip.keys():
        trip["stage"] = "details"
        await ctx.send(user, outbound(trip_question(trip), end=False))
    elif not trip["people"]:
        trip["stage"] = "rolling"
        await ctx.send(user, outbound(trip_welcome(trip), end=False))
    else:
        trip["stage"] = "invite"
        await ctx.send(user, outbound(trip_invite(trip), end=False))


@captain_protocol.on_message(ChatMessage)
async def captain_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
    if sender == droid.address:
        tag, text = split_tag(spoken(msg))
        job = jobs.get(tag)
        if job is None:
            return
        picked = text.removeprefix("DISPATCH ").strip()
        if picked == "Trip":
            jobs.pop(tag, None)
            await plan_trip(ctx, job["user"], job["text"], loose=False)
            return
        target = NAMES.get(picked)
        if target is None or target is droid:
            jobs.pop(tag, None)
            await ctx.send(job["user"], outbound("No specialist was called.", end=True))
            return
        ctx.logger.info("Droid dispatched %s", BY_ADDRESS[target.address])
        await ctx.send(target.address, outbound(f"#{tag} {job['text']}", end=False))
        return
    if sender in BY_ADDRESS:
        tag, _ = split_tag(spoken(msg))
        job = jobs.pop(tag, None)
        if job is not None:
            await ctx.send(job["user"], forward(msg, BY_ADDRESS[sender], end=sender != cashier.address))
        return
    text = incoming_text(msg)
    if not text:
        return
    ready = READY.search(plain(text).lower())
    trip = trips.get(sender)
    if trip is None and ready:
        trip = next((t for t in reversed(trips.values()) if t["stage"] == "invite"), None)
    if trip and trip["stage"] == "invite" and ready:
        trip["stage"] = "rolling"
        await ctx.send(sender, outbound(trip_welcome(trip), end=False))
        return
    if trip and trip["stage"] == "details" and choose(text) in ("", "Trip"):
        await plan_trip(ctx, sender, text, loose=True)
        return
    tag = uuid4().hex[:8]
    jobs[tag] = {"user": sender, "text": text}
    ctx.logger.info("ASI:One message: %s", text[:180])
    await ctx.send(droid.address, outbound(f"#{tag} {text}", end=False))


@captain_protocol.on_message(ChatAcknowledgement)
async def captain_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info("Ack from %s", sender)


captain.include(captain_protocol, publish_manifest=True)

AGENTS = (captain, droid, chef, pit, lifeline, waiter, cashier, ledger)


def inspector(agent: Agent) -> str:
    uri = quote(f"http://127.0.0.1:{agent._port}", safe="")
    return f"https://agentverse.ai/inspect/?uri={uri}&address={agent.address}"


def main():
    lines = [f"{agent.name} {agent.address} {inspector(agent)}" for agent in AGENTS]
    Path(__file__).with_name("addresses.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    for line in lines:
        print(line, flush=True)
    loop = asyncio.get_event_loop()
    try:
        with contextlib.suppress(asyncio.CancelledError, KeyboardInterrupt):
            loop.run_until_complete(asyncio.gather(*(agent.run_async() for agent in AGENTS)))
    finally:
        if not loop.is_closed():
            loop.stop()
            loop.close()
