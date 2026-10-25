"""All Detour agents that register on Agentverse."""

import asyncio
import base64
import contextlib
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

asyncio.set_event_loop(asyncio.new_event_loop())

import httpx
from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents.mailbox import AgentverseConnectRequest, register_in_agentverse
from uagents_core.identity import Identity
from uagents_core.registration import AgentProfile, RegistrationRequest
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    MetadataContent,
    ResourceContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.config import AgentverseConfig
from uagents_core.storage import ExternalStorage
from uagents_core.contrib.protocols.chat.cards import (
    CarouselCardPayload,
    CarouselItem,
    CtaAction,
    CustomCardPayload,
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
from trip_agent import trip_card_reply

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

APP = os.getenv("DETOUR_APP_URL", "http://localhost:3000").rstrip("/")
AUTHOR = os.getenv("DETOUR_AUTHOR", "Group chat")

SEED_PREFIX = os.getenv("DETOUR_SEED_PREFIX", "")
if not SEED_PREFIX:
    raise SystemExit("Set DETOUR_SEED_PREFIX in .env. It is the private part of every agent seed.")

PROFILES = Path(__file__).with_name("profiles")
AGENTVERSE_KEY = os.getenv("AGENTVERSE_API_KEY", "").strip()

ROSTER = (
    (
        "Atlas", "atlas-guide", "trip-captain", 8001,
        "Atlas, Detour's group travel captain. Plan a trip with friends, vote on stays and things to do, and "
        "get help on the road: breakfast, gas, urgent care, a menu, payment, or the bill split.",
        ["Let's plan a trip", "Let's go on a road trip", "I'm starving, breakfast?", "We're low on gas"],
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
    (
        "StayScout", "detour-stays", "stay-scout", 8011,
        "Finds hotels, inns, and campgrounds near your destination as a card the whole group can vote on.",
        ["where should we stay in Big Sur?", "find a hotel near Carmel", "campsites near Big Sur"],
    ),
    (
        "Local Guide", "detour-guide", "local-guide", 8012,
        "Finds things to do near your destination, such as hikes, beaches, and sights, as a card the group votes on.",
        ["things to do in Big Sur", "best hikes near Carmel", "what should we see in Santa Cruz?"],
    ),
    (
        "Itinerary", "detour-planner", "itinerary", 8013,
        "Builds a day-by-day trip plan with Factory Droid from real Google Places results and the group's votes.",
        ["plan our days", "make an itinerary for the trip", "what should we do each day?"],
    ),
    (
        "Curator", "detour-curator", "curator", 8014,
        "Turns the photos your group shares during the trip into a post: picks the set that looks best together "
        "and writes the caption and hashtags.",
        ["curate a post from our trip photos", "pick our best photos for Instagram", "write a caption for our pics"],
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
        await register_id_card(agent, handle, description)
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


captain, droid, chef, pit, lifeline, waiter, cashier, ledger, stays, guide, planner, curator = (
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
    "Stays": stays,
    "Guide": guide,
    "Planner": planner,
    "Curator": curator,
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
    # ASI:One may keep the mention, such as "@atlas-guide plan a trip" or an agent1... address.
    parts = text.split()
    if parts and parts[0].startswith("@"):
        return " ".join(parts[1:]).strip()
    return text.strip()


def card_command(selection: dict) -> str:
    action = str(selection.get("action") or "")
    if action == "ask" and selection.get("text"):
        return str(selection["text"])
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


ROUTES = (
    ("Lifeline", "dizzy|hurt|hurts|sick|pain|pharmacy|hospital|emergency|clinic|urgent care"),
    ("Pit Stop", "gas|fuel|refuel"),
    ("Cashier", "pay|charge|checkout|check out"),
    ("Ledger", "split|owe|owes|splitwise"),
    ("Waiter", "menu|order"),
    ("Personal Chef", "breakfast|brunch|hungry|starving|food|eat|restaurant"),
    ("Stays", "hotel|motel|inn|lodging|airbnb|campsite|campground|camping|place to stay|where to stay|stay tonight"),
    ("Guide", "things to do|activities|attractions|sights|sightseeing|hikes?|events"),
    ("Planner", "itinerary|schedule|day by day|plan (?:our|the) days|each day"),
    ("Curator", "post|caption|curate|instagram|carousel|album|photos|pics"),
    ("Trip", "trip|road trip|let'?s go"),
)


def choose(text: str) -> str:
    lowered = text.replace("\u2019", "'").lower()
    hits = [name for name, words in ROUTES if re.search(rf"\b(?:{words})\b", lowered)]
    if "Lifeline" in hits:
        return "Lifeline"
    return hits[0] if len(hits) == 1 else ""


class Unreachable(RuntimeError):
    pass


async def send_once(method: str, path: str, body: dict | None, timeout: float) -> httpx.Response:
    # One retry when the web app cannot be reached. A slow reply is never retried, so a payment never runs twice.
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                return await client.request(method, f"{APP}{path}", json=body)
        except (httpx.ConnectError, httpx.RemoteProtocolError) as error:
            if attempt:
                raise Unreachable(f"The Detour app at {APP} is not reachable.") from error
            await asyncio.sleep(1.5)
    raise Unreachable(f"The Detour app at {APP} is not reachable.")


async def post(path: str, body: dict, timeout: float = 75) -> dict:
    response = await send_once("POST", path, body, timeout)
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 400:
        raise RuntimeError(payload.get("error") or f"{path} returned {response.status_code}")
    return payload


async def trip() -> dict:
    response = await send_once("GET", "/api/trip", None, 20)
    response.raise_for_status()
    return response.json()


def friendly(name: str, error: Exception) -> str:
    if isinstance(error, Unreachable):
        return f"{name} can't reach the Detour service right now. Try again in a minute."
    if isinstance(error, httpx.TimeoutException):
        return f"{name} took too long to answer. Try again in a moment."
    return f"{name} couldn't finish that: {str(error)[:300]}"


# Agent ID cards. Every agent publishes who it is on startup, and signs each action it takes with its own
# key. The action key makes a repeated delivery or a double tap happen once. Anyone can verify a signature
# from the agent's address alone (see verify_actions).
def action_digest(key: str, address: str, kind: str, text: str, result: str, status: str, at: int) -> bytes:
    record = {"key": key, "agent": address, "kind": kind, "text": text, "result": result, "status": status, "at": at}
    return hashlib.sha256(json.dumps(record, sort_keys=True, separators=(",", ":")).encode()).digest()


async def register_id_card(agent: Agent, handle: str, role: str):
    protocols = ["AgentChatProtocol"] + (["AgentPaymentProtocol"] if handle == "payment-agent" else [])
    body = {"op": "register", "name": agent.name, "handle": handle, "address": agent.address, "role": role,
            "protocols": protocols}
    with contextlib.suppress(Exception):
        await post("/api/actions", body, timeout=10)


async def claimed(key: str) -> dict | None:
    """The earlier action with this key, if it already happened."""
    try:
        return (await post("/api/actions", {"op": "claim", "key": key}, timeout=10)).get("action")
    except Exception:
        return None


async def sign_action(
    agent: Agent, key: str, kind: str, text: str, result: str, status: str = "done", ms: float | None = None
):
    text, result, at = text[:600], result[:1200], int(time.time() * 1000)
    digest = action_digest(key, agent.address, kind, text, result, status, at)
    body = {
        "op": "record", "key": key, "agent": agent.name, "address": agent.address, "kind": kind,
        "text": text, "result": result, "status": status, "at": at,
        "digest": digest.hex(), "signature": agent._identity.sign_digest(digest),
        **({"ms": round(ms)} if ms is not None else {}),
    }
    with contextlib.suppress(Exception):
        await post("/api/actions", body, timeout=10)


def verified(action: dict) -> bool:
    digest = action_digest(
        action["key"], action["address"], action["kind"], action["text"], action["result"], action["status"],
        int(action["at"]),
    )
    with contextlib.suppress(Exception):
        return digest.hex() == action["digest"] and Identity.verify_digest(action["address"], digest, action["signature"])
    return False


def as_text(reply: "str | ChatMessage") -> str:
    if isinstance(reply, ChatMessage):
        cards = sum(isinstance(item, MetadataContent) for item in reply.content)
        return spoken(reply) + (" [card]" if cards else "")
    return str(reply)


def attach(agent: Agent, work):
    protocol = Protocol(spec=chat_protocol_spec)

    @protocol.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
        tag, text = split_tag(clean(spoken(msg)))
        if not text:
            return
        key = f"{agent.address}:{msg.msg_id}"
        if earlier := await claimed(key):
            # The same message arrived twice. Answer with the signed result instead of doing the work again.
            await ctx.send(sender, tagged(earlier["result"], tag))
            return
        status, started = "done", time.monotonic()
        try:
            reply = await work(text)
        except Exception as error:
            ctx.logger.exception("%s failed", agent.name)
            reply, status = friendly(agent.name, error), "error"
        await sign_action(agent, key, agent.name, text, as_text(reply), status, (time.monotonic() - started) * 1000)
        await ctx.send(sender, tagged(reply, tag))

    @protocol.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        ctx.logger.info("Ack from %s", sender)

    agent.include(protocol, publish_manifest=True)


CARD_COMMANDS = (
    ("Waiter", re.compile(r"^(menu at |order .+ for .+ at )", re.I)),
    ("Cashier", re.compile(r"^alex and jordan confirm pay$", re.I)),
)
CONTEXT = re.compile(r"^\[\[near=(.*?)\|home=(.*?)\]\] ")


def with_context(text: str, near: str, home: str) -> str:
    if not near and not home:
        return text
    return f"[[near={near.replace('|', ' ')}|home={home.replace('|', ' ')}]] {text}"


def read_context(text: str) -> tuple[str, str, str]:
    match = CONTEXT.match(text)
    if not match:
        return "", "", text
    return match.group(1), match.group(2), text[match.end() :]


async def droid_work(text: str) -> str:
    picked, near = "", ""
    if choose(text) == "Lifeline":
        picked = "Lifeline"
    else:
        picked = next((name for name, pattern in CARD_COMMANDS if pattern.match(text)), "")
    if not picked:
        payload = await trip()
        plan = await post("/api/plan", {"tripId": payload["tripId"], "text": text})
        picked = plan.get("agent") or "none"
        near = str(plan.get("near") or "").strip()
    if picked != "Trip" and (picked not in NAMES or picked == "Droid"):
        picked = "none"
    return f"DISPATCH {picked}" + (f" | near: {near}" if near else "")


async def search_work(agent_name: str, text: str) -> str | ChatMessage:
    near, home, text = read_context(text)
    payload = await trip()
    result = await post(
        "/api/specialist",
        {
            "tripId": payload["tripId"],
            "author": AUTHOR,
            "agent": agent_name,
            "text": text,
            "near": near,
            "home": home,
        },
    )
    places = result.get("places") or []
    card = CARDS.get(agent_name)
    if card is None or not places:
        return result["reply"]
    title, label, selection = card
    items = [
        CarouselItem(
            id=f"stop-{index}",
            title=str(place["name"])[:80],
            subtitle=(str(place.get("detail") or "")[:120] or None),
            secondary_text=(" · ".join(filter(None, [
                str(place.get("rating") or ""),
                f"{place['miles']} mi" if isinstance(place.get("miles"), (int, float)) else "",
            ]))[:60] or None),
            primary_cta=CtaAction(label=label, selection=selection(str(place["name"])), primary=True),
        )
        for index, place in enumerate(places[:5])
        if place.get("name")
    ]
    if not items:
        return result["reply"]
    return with_card(result["reply"], CarouselCardPayload(title=title, items=items))


async def curator_work(text: str) -> str | ChatMessage:
    payload = await trip()
    post_ = await post("/api/curate", {"tripId": payload["tripId"], "text": text}, timeout=90)
    photos = post_.get("photos") or []
    caption, tags = str(post_.get("caption") or ""), " ".join(post_.get("hashtags") or [])
    theme = str(post_.get("theme") or "trip")
    children: list[dict] = []
    if photos:
        children.append({"type": "image", "src": photos[0]["url"], "alt": f"Cover photo, {theme}", "aspect_ratio": "4:3"})
    rest = [photo["url"] for photo in photos[1:]]
    for start in range(0, len(rest), 3):
        children.append({
            "type": "group", "direction": "row", "gap": 6,
            "children": [{"type": "image", "src": url, "alt": "Trip photo", "aspect_ratio": "1:1"} for url in rest[start:start + 3]],
        })
    children += [
        {"type": "text", "value": caption[:400], "style": "emphasis"},
        {"type": "text", "value": tags[:200], "style": "muted"},
        {"type": "group", "direction": "row", "gap": 6, "children": [
            {"type": "badge", "label": theme, "variant": "success"},
            {"type": "badge", "label": f"{len(photos)} of {post_.get('total', len(photos))} photos", "variant": "info"},
        ]},
        {"type": "text", "value": f"Palette {'  '.join(post_.get('palette') or [])}  ·  {post_.get('source', '')}"[:200], "style": "muted"},
        {"type": "button", "label": "Another set", "action": {"selection": {"action": "ask", "text": "curate another post"}}},
    ]
    card = CustomCardPayload.model_validate({
        "root": {"type": "section", "title": f"Your post · {theme}",
                 "subtitle": "The photos that look best together, with a caption", "children": children}
    })
    links = "\n".join(photo["url"] for photo in photos)
    article = "an" if theme[:1].lower() in "aeiou" else "a"
    return with_card(f"Here's your post: {len(photos)} photos with {article} {theme} look.\n{caption}\n{tags}\n{links}", card)


# Specialists whose results come back as a carousel: card title, button label, and what a tap sends.
CARDS = {
    "Personal Chef": ("Places to eat", "See menu", lambda name: {"action": "menu", "place": name}),
    "Stays": ("Places to stay: vote", "Vote for this", lambda name: {"action": "vote", "kind": "stay", "option": name}),
    "Guide": ("Things to do: vote", "Vote for this", lambda name: {"action": "vote", "kind": "activity", "option": name}),
}


async def planner_work(text: str) -> str | ChatMessage:
    payload = await trip()
    plan = await post("/api/itinerary", {"tripId": payload["tripId"], "text": text}, timeout=110)
    info = plan.get("trip") or {}
    route = " to ".join(filter(None, [info.get("origin"), info.get("destination")]))
    children: list[dict] = [
        {"type": "text", "value": str(plan.get("summary") or "Here is your plan.")[:300], "style": "muted"},
    ]
    for day in plan.get("days") or []:
        children.append({"type": "heading", "value": str(day["title"])[:80], "level": 3})
        for stop in day.get("stops") or []:
            line = f"{stop['time']}  ·  {stop['place']}"
            children.append({"type": "text", "value": line[:160], "style": "emphasis"})
            if stop.get("note"):
                children.append({"type": "text", "value": str(stop["note"])[:160], "style": "muted"})
    children += [
        {"type": "divider"},
        {"type": "text", "value": str(plan.get("source") or "")[:160], "style": "muted"},
        {
            "type": "group",
            "direction": "row",
            "gap": 8,
            "children": [
                {"type": "button", "label": "Find stays", "primary": True,
                 "action": {"selection": {"action": "ask", "text": "where should we stay?"}}},
                {"type": "button", "label": "Things to do",
                 "action": {"selection": {"action": "ask", "text": "things to do there"}}},
            ],
        },
    ]
    card = CustomCardPayload.model_validate({
        "root": {
            "type": "section",
            "title": "Your trip plan",
            "subtitle": " · ".join(filter(None, [route, info.get("dates")])) or None,
            "children": children,
        }
    })
    days = plan.get("days") or []
    text_version = f"{plan.get('summary', '')} " + " ".join(
        f"{day['title']}: " + ", ".join(f"{stop['time']} {stop['place']}" for stop in day.get("stops") or []) + "."
        for day in days
    )
    return with_card(text_version.strip(), card)


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
    lead = str((payload.get("trip") or {}).get("leadName") or "Alex")
    items = [
        CarouselItem(
            id=f"dish-{index}",
            title=str(dish["name"])[:80],
            subtitle=(str(dish.get("note") or "")[:120] or None),
            secondary_text=f"${float(dish['price']):.2f}",
            primary_cta=CtaAction(
                label="Add to order",
                selection={"action": "order", "item": dish["name"], "member": lead, "place": place},
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
            f"The sample order at {place} is ${dollars}. Approve it to run a proof-of-concept Stripe test "
            "payment, no real money, and split it in Splitwise.",
            card,
        ), None
    if "checkout" not in text.lower():
        paid = await post(
            "/api/pay",
            {"tripId": payload["tripId"], "placeName": place, "alexConfirmed": True, "jordanConfirmed": True},
        )
        return (
            f"Proof of concept: Stripe test payment {paid['paymentId']} is {paid['status']} for "
            f"${paid['dollars']} at {place}. No real money moved. {paid.get('splitNote', '')}"
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
attach(stays, lambda text: search_work("Stays", text))
attach(guide, lambda text: search_work("Guide", text))
attach(planner, planner_work)
attach(curator, curator_work)

cashier_chat = Protocol(spec=chat_protocol_spec)


@cashier_chat.on_message(ChatMessage)
async def cashier_on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
    tag, text = split_tag(incoming_text(msg))
    if not text:
        return
    key = f"{cashier.address}:{msg.msg_id}"
    if earlier := await claimed(key):
        await ctx.send(sender, tagged(earlier["result"], tag))
        return
    status, started = "done", time.monotonic()
    try:
        reply, payment = await cashier_turn(text)
    except Exception as error:
        ctx.logger.exception("cashier failed")
        reply, payment, status = friendly(cashier.name, error), None, "error"
    await sign_action(cashier, key, "payment" if "confirm" in text.lower() else "PayPilot", text, as_text(reply), status,
                      (time.monotonic() - started) * 1000)
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

# Atlas's memory. Convex keeps the durable copy (see /api/crew), so a restart loses nothing,
# and everyone in an ASI:One group chat shares one trip.
crews: dict[str, dict] = {}  # trip id -> trip
chats: dict[str, str] = {}  # ASI:One sender -> trip id
spots: dict[str, str] = {}
READY = re.compile(
    r"\b(all in|all here|all set|every(one|body)'?s? (is )?(in|here)|we('?re| are) (all )?(in|here)|joined"
    r"|already (added|invited|here|in (the|this) (chat|group))|(she|he|they)('?s|'?re| is| are) (already )?(here|in))\b"
)
SOLO = re.compile(r"\b(just me|only me|solo|alone|by myself)\b")
DATEISH = re.compile(
    r"\d|\b(today|tonight|tomorrow|day after|weekend|next|this|week|month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"
    r"|mon|tue|wed|thu|fri|sat|sun)[a-z]*\b",
    re.I,
)
STOP = r"(?=\s+(?:with|along|on|and)\b|[,.?!]|$)"
WITH = re.compile(r"\bwith\s+(.+?)(?=\s+(?:from|to|along)\b|[.?!]|$)", re.I)
FROM_TO = re.compile(rf"\bfrom\s+(.+?)\s+to\s+(.+?){STOP}", re.I)
FROM = re.compile(rf"\bfrom\s+(.+?){STOP}", re.I)
X_TO_Y = re.compile(rf"^(.+?)\s+to\s+(.+?){STOP}", re.I)
COMING = re.compile(r"([\w' ,&]+?)\s+(?:is|are|will be)\s+(?:also\s+)?(?:coming|joining)\b", re.I)
# Words that are never a place or a name, so "plan a trip" is not saved as the starting city.
FILLER = re.compile(
    r"\b(?:let'?s\s+)?plan(?:ning)?\s+(?:a\s+|our\s+|the\s+)?(?:road\s+)?trip\b|\broad\s*trip\b|\blet'?s\s+go\b"
    r"|\b(?:a|the|our)\s+trip\b|\btrip\b|\b(?:hi|hey|hello|please|ok(?:ay)?|sure|yes|yeah|so)\b",
    re.I,
)
NOT_NAMES = {"me", "i", "myself", "us", "we", "friends", "my friends", "they", "also"}
NOT_NAME_WORDS = {"trip", "road", "drive", "going", "go", "we", "i"}
SKILLS = (
    "- plan the days with a day-by-day itinerary (Itinerary)\n"
    "- find places to stay, and everyone votes (StayScout)\n"
    "- find things to do, and everyone votes (Local Guide)\n"
    "- turn the photos you share here into a post with a caption (Curator)\n"
    "- find breakfast on the way (BiteScout)\n"
    "- find gas when you're low (FuelFox)\n"
    "- find urgent care if someone feels unwell (CareRoute)\n"
    "- open a menu and take the group's order (MenuScout)\n"
    "- take payment with a Stripe test checkout (PayPilot)\n"
    "- split the bill in Splitwise (Ledger)"
)
BOARD = os.getenv("DETOUR_PUBLIC_URL", "").rstrip("/")


def plain(text: str) -> str:
    return text.replace("’", "'").strip()


def names_in(text: str) -> list[str]:
    names = []
    for part in re.split(r",|\band\b|&", text, flags=re.I):
        name = re.sub(r"^(my\s+)?(friends?|buddy|buddies)\s+", "", part.strip(" .!?"), flags=re.I).strip()
        if name and name.lower() not in NOT_NAMES and not NOT_NAME_WORDS & set(name.lower().split()):
            names.append(name[:1].upper() + name[1:])
    return names


def joined(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def place(text: str) -> str:
    text = text.strip()
    return text.title() if text.islower() else text


def cut(text: str, match: re.Match) -> str:
    return (text[: match.start()] + " " + text[match.end() :]).strip(" ,")


def read_trip(text: str, trip: dict, loose: bool):
    text = plain(text)
    solo = bool(SOLO.search(text.lower()))
    if solo:
        trip["people"] = []
    found_route = False
    people: list[str] = []
    leftovers = []
    for sentence in re.split(r"[.!?;]+", text):
        sentence = sentence.strip()
        if match := FROM_TO.search(sentence):
            trip["start"], trip["end"] = place(match.group(1)), place(match.group(2))
            sentence, found_route = cut(sentence, match), True
        elif match := FROM.search(sentence):
            trip["start"] = place(match.group(1))
            sentence, found_route = cut(sentence, match), True
        if match := COMING.search(sentence):
            people += names_in(match.group(1))
            sentence = cut(sentence, match)
        if (match := WITH.search(sentence)) and names_in(match.group(1)):
            people += names_in(match.group(1))
            sentence = cut(sentence, match)
        elif match:
            sentence = cut(sentence, match)
        if sentence:
            leftovers.append(sentence)
    if people and not solo:
        trip["people"] = list(dict.fromkeys(people))
    rest = re.sub(r"\s+", " ", FILLER.sub(" ", " ".join(leftovers))).strip(" ,.!?")
    if found_route or not loose or not rest or len(rest.split()) > 6:
        return
    if "start" not in trip and (match := X_TO_Y.search(rest)):
        trip["start"], trip["end"] = place(match.group(1)), place(match.group(2))
    elif "start" in trip and "end" not in trip:
        trip["end"] = place(re.sub(r"^to\s+", "", rest, flags=re.I))
    elif "start" not in trip:
        trip["start"] = place(re.sub(r"^from\s+", "", rest, flags=re.I))
    elif "people" not in trip:
        trip["people"] = names_in(rest)


def has_details(text: str, trip: dict) -> bool:
    probe = dict(trip)
    read_trip(text, probe, loose=False)
    return probe != trip


def trip_question(trip: dict) -> str:
    # Say back what we already understood, then ask only for what's missing.
    known = []
    if "people" in trip:
        people = trip["people"]
        known.append(f"{joined(people)} {'is' if len(people) == 1 else 'are'} coming" if people else "it's just you")
    if "start" in trip:
        known.append(f"starting from {trip['start']}")
    # (what to tell me, the same as a question, an example answer)
    missing = []
    if "start" not in trip:
        missing.append(("where you're starting from", "where are you starting from", "from San Jose"))
    if "end" not in trip:
        missing.append(("where you're headed", "where are you headed", "to Big Sur"))
    if "people" not in trip:
        missing.append(("who's coming", "who's coming with you", "with Jordan and Priya, or just me"))
    opening = f"Got it, {', '.join(known)}. " if known else "Road trip, love it. "
    if len(missing) == 1:
        _, question, example = missing[0]
        return f"{opening}Last thing: {question}? Like: {example}."
    asks = [f"{tell} (like: {example})" for tell, _, example in missing]
    return f"{opening}Tell me {joined(asks)}."


def board_line() -> str:
    return f"\nLive trip board for everyone: {BOARD}" if BOARD else ""


def trip_invite(trip: dict) -> str:
    names = joined(trip["people"])
    return (
        f"Got it: {trip['start']} to {trip['end']} with {names}.\n"
        "Already in this chat? Just say \"we're all in\". If not, bring them in:\n"
        f"- If they're your ASI:One friends, tell your AI: Add {names} to this chat.\n"
        "- If not, tap Share at the top of this chat, copy the invite link, and send it to them. "
        "Turn on Public chat in chat settings so the link works.\n"
        "Say \"we're all in\" when everyone is here." + board_line()
    )


def trip_welcome(trip: dict) -> str:
    people = trip.get("people") or []
    hello = f"Yay, let's go, {joined(people)}!" if people else "Yay, let's go!"
    route = f" from {trip['start']} to {trip['end']}" if trip.get("start") and trip.get("end") else ""
    return (
        f"{hello} I'll be your complete travel concierge{route}, before the trip and while your hands are on "
        f"the wheel. Mention me any time and I'll:\n{SKILLS}\n"
        "Everyone in this chat can vote on stays and things to do, and I keep the tally.\n"
        "Share photos with me along the way. Try: where should we stay? or plan our days" + board_line()
    )


async def load_trip(user: str) -> dict | None:
    if user in chats:
        return crews.get(chats[user])
    try:
        found = (await post("/api/crew", {"action": "load", "chat": user}, timeout=15)).get("trip")
    except Exception:
        return None
    if not found:
        return None
    trip_id = found["tripId"]
    if trip_id not in crews:
        trip = {"stage": found["stage"]}
        for key in ("start", "end", "dates"):
            if found.get(key):
                trip[key] = found[key]
        if found.get("people") is not None:
            trip["people"] = found["people"]
        crews[trip_id] = trip
    if found.get("near"):
        spots.setdefault(user, found["near"])
    chats[user] = trip_id
    return crews[trip_id]


async def save_trip(ctx: Context, user: str, trip: dict, fresh: bool = False):
    body = {
        "action": "save",
        "chat": user,
        "fresh": fresh,
        "stage": trip.get("stage", "details"),
        "start": trip.get("start", ""),
        "end": trip.get("end", ""),
        "dates": trip.get("dates", ""),
        "people": trip.get("people"),
        "near": spots.get(user, ""),
    }
    try:
        trip_id = (await post("/api/crew", body, timeout=15))["tripId"]
    except Exception as error:
        ctx.logger.warning("The trip was not saved to Convex: %s", error)
        trip_id = None if fresh else chats.get(user)
        trip_id = trip_id or f"local-{uuid4().hex[:8]}"
    crews[trip_id] = trip
    chats[user] = trip_id


async def plan_trip(ctx: Context, user: str, text: str, loose: bool):
    trip = await load_trip(user)
    # A new route after the trip is rolling starts a new trip instead of being ignored.
    fresh = trip is None or (trip.get("stage") == "rolling" and has_details(text, {}))
    if fresh:
        trip = {}
    elif trip["stage"] == "rolling":
        await ctx.send(user, outbound(trip_welcome(trip), end=False))
        return
    read_trip(text, trip, loose)
    if not {"start", "end", "people"} <= trip.keys():
        trip["stage"], reply = "details", trip_question(trip)
    elif not trip["people"]:
        trip["stage"], reply = "rolling", trip_welcome(trip)
    else:
        trip["stage"], reply = "invite", trip_invite(trip)
    await save_trip(ctx, user, trip, fresh)
    await ctx.send(user, outbound(reply, end=False))


def vote_in(msg: ChatMessage) -> tuple[str, str] | None:
    """A Vote tap: ASI:One sends it as card metadata, some clients as JSON text."""
    selections = []
    for item in msg.content:
        if isinstance(item, MetadataContent):
            response = extract_card_response(item)
            if response and response.selection:
                selections.append(response.selection)
        elif isinstance(item, TextContent) and '"vote"' in item.text:
            for raw in re.findall(r"\{[^{}]*\}", item.text):
                with contextlib.suppress(ValueError):
                    selections.append(json.loads(raw))
    for selection in selections:
        if isinstance(selection, dict) and selection.get("action") == "vote" and selection.get("option"):
            kind = "activity" if selection.get("kind") == "activity" else "stay"
            return kind, str(selection["option"])
    return None


async def cast_vote(user: str, kind: str, option: str) -> str:
    await load_trip(user)
    body = {"kind": kind, "name": option, "voter": user}
    trip_id = chats.get(user, "")
    if trip_id and not trip_id.startswith("local-"):
        body["tripId"] = trip_id
    try:
        result = await post("/api/vote", body, timeout=20)
    except Exception as error:
        return friendly("Atlas", error)
    tally = ", ".join(f"{row['name']} ({row['votes']})" for row in result.get("tally") or [])
    what = "stays" if kind == "stay" else "things to do"
    moved = " You changed your vote." if result.get("moved") else ""
    return (
        f"Vote counted for {option}.{moved}\nGroup tally for {what}: {tally}.\n"
        "Everyone in the chat can tap Vote on the card. Say \"plan our days\" and the plan uses the winners."
    )


STORAGE = ExternalStorage(identity=captain._identity, storage_url=AgentverseConfig().storage_api)


async def photo_bytes(item: ResourceContent) -> str:
    """The photo as base64. ASI:One keeps shared files in Agentverse storage, read with Atlas's own identity."""
    resources = item.resource if isinstance(item.resource, list) else [item.resource]
    try:
        data = await asyncio.to_thread(STORAGE.download, str(item.resource_id))
        if data.get("contents"):
            return data["contents"]
    except Exception:
        pass
    uri = resources[0].uri if resources else ""
    if uri.startswith(("https://", "http://")):
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.get(uri, headers={"user-agent": "Detour/1.0 (https://github.com/aj1575/detour)"})
            response.raise_for_status()
            return base64.b64encode(response.content).decode()
    raise RuntimeError("the photo could not be downloaded")


async def save_photos(ctx: Context, sender: str, items: list[ResourceContent]) -> str:
    await load_trip(sender)
    trip_id = chats.get(sender, "")
    saved, total, themes, failed = 0, 0, [], 0
    for item in items:
        try:
            body = {"data": await photo_bytes(item), "sharedBy": "Group chat"}
            if trip_id and not trip_id.startswith("local-"):
                body["tripId"] = trip_id
            result = await post("/api/photos", body, timeout=60)
            saved, total = saved + 1, int(result.get("count") or total)
            themes.append(str((result.get("look") or {}).get("theme") or ""))
        except Exception as error:
            failed += 1
            ctx.logger.warning("Photo was not saved: %s", error)
    if not saved:
        return "I couldn't save that photo. Try sending it again."
    article = "an" if themes and themes[-1][:1] in "aeiou" else "a"
    look = f" It has {article} {themes[-1]} look." if len(themes) == 1 and themes[0] else ""
    missed = f" {failed} didn't upload." if failed else ""
    return (
        f"Added {saved} photo{'s' if saved != 1 else ''} to the trip album ({total} so far).{look}{missed} "
        "Keep sharing, and say \"curate a post\" when you want the best set and a caption."
    )


VERIFY = re.compile(r"\b(verify|audit)\b.*\b(agents?|actions?|ledger)\b|\bagent ids?\b|\bid cards?\b|\bwho did what\b", re.I)
TAP_WINDOW_S = 120


def selection_of(item) -> dict:
    if isinstance(item, MetadataContent):
        response = extract_card_response(item)
        if response and response.selection:
            return response.selection
    return {}


def entry_key(sender: str, msg: ChatMessage) -> tuple[str, str]:
    """One key per user action: a card tap counts once per card (or per two minutes), a message once per id."""
    for item in msg.content:
        if isinstance(item, MetadataContent):
            response = extract_card_response(item)
            if response and response.selection:
                card = str(response.card_id or int(time.time() // TAP_WINDOW_S))
                selection = json.dumps(response.selection, sort_keys=True)
                digest = hashlib.sha256(f"{sender}|{card}|{selection}".encode()).hexdigest()[:32]
                return f"tap:{digest}", selection
    return f"msg:{sender}:{msg.msg_id}", clean(msg.text())


async def id_cards_reply() -> ChatMessage:
    actions = (await post("/api/actions", {"op": "recent", "limit": 150}, timeout=15)).get("actions") or []
    mine: dict[str, list[dict]] = {}
    for action in actions:
        mine.setdefault(action["address"], []).append(action)
    rows, checked, failed = [], 0, 0
    for agent, (_name, handle, *_rest) in zip(AGENTS, ROSTER):
        done = mine.get(agent.address, [])
        bad = sum(not verified(action) for action in done)
        checked, failed = checked + len(done), failed + bad
        last = done[0] if done else None
        badges = [{"type": "badge", "label": f"{len(done)} signed actions", "variant": "info"}]
        if done:
            badges.append({"type": "badge", "label": "all verified" if not bad else f"{bad} failed the check",
                           "variant": "success" if not bad else "warning"})
        column = [
            {"type": "heading", "value": agent.name, "level": 3},
            {"type": "text", "value": f"@{handle} · {agent.address[:14]}…{agent.address[-6:]}", "style": "muted"},
            {"type": "group", "direction": "row", "gap": 6, "children": badges},
        ]
        if last:
            column.append({"type": "text", "value": f"Last: {read_context(last['text'])[2][:70]}", "style": "muted"})
        rows.append({"children": [{"type": "group", "direction": "column", "gap": 4, "children": column}]})
    card = CustomCardPayload.model_validate({
        "root": {
            "type": "section",
            "title": "Agent ID cards",
            "subtitle": "Every action is signed with the agent's own key. I just checked each signature.",
            "children": [{"type": "list", "items": rows}],
        }
    })
    summary = (
        f"Checked {checked} signed actions from {len(AGENTS)} agents: "
        + ("every signature is valid." if not failed else f"{failed} failed the check, so they were changed after signing.")
    )
    return with_card(summary, card)


@captain_protocol.on_message(ChatMessage)
async def captain_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
    if sender == droid.address:
        tag, text = split_tag(spoken(msg))
        job = jobs.get(tag)
        if job is None:
            return
        picked, _, near = text.removeprefix("DISPATCH ").partition(" | near: ")
        picked, near = picked.strip(), near.strip()
        if picked == "Trip":
            jobs.pop(tag, None)
            await plan_trip(ctx, job["user"], job["text"], loose=False)
            return
        user = job["user"]
        if near and picked not in ("Stays", "Guide"):
            spots[user] = near
        target = NAMES.get(picked)
        if target is None or target is droid:
            jobs.pop(tag, None)
            reply = (
                f"Got it, you're near {near}. Ask me for food, gas, or urgent care and I'll search from there."
                if near
                else "I didn't catch a request there. Ask me for stays, things to do, a day-by-day plan, food, "
                "gas, or urgent care."
            )
            if near and (trip := crews.get(chats.get(user, ""))):
                await save_trip(ctx, user, trip)
            await ctx.send(user, outbound(reply, end=not near))
            return
        ctx.logger.info("Droid dispatched %s", BY_ADDRESS[target.address])
        body = job["text"]
        trip = crews.get(chats.get(user, ""), {})
        if target in (chef, pit, lifeline):
            body = with_context(body, spots.get(user, ""), trip.get("start", ""))
        elif target in (stays, guide):
            # Stays and things to do are about where you're going, unless the message names a place.
            body = with_context(body, near or trip.get("end", "") or spots.get(user, ""), trip.get("start", ""))
        await ctx.send(target.address, outbound(f"#{tag} {body}", end=False))
        return
    if sender in BY_ADDRESS:
        tag, _ = split_tag(spoken(msg))
        job = jobs.pop(tag, None)
        if job is not None:
            await ctx.send(job["user"], forward(msg, NAMES[BY_ADDRESS[sender]].name, end=sender != cashier.address))
        return
    key, said = entry_key(sender, msg)
    if await claimed(key):
        if key.startswith("tap:"):
            await ctx.send(sender, outbound(
                "That tap was already handled, so I didn't run it twice. Every action is recorded once on "
                "Detour's signed ledger. Say \"verify agents\" to see it.", end=False))
        return
    await sign_action(captain, key, "tap" if key.startswith("tap:") else "message", said, "accepted")
    if VERIFY.search(clean(msg.text())):
        await ctx.send(sender, await id_cards_reply())
        return
    if vote := vote_in(msg):
        await ctx.send(sender, outbound(await cast_vote(sender, *vote), end=False))
        return
    if photos := [item for item in msg.content if isinstance(item, ResourceContent)]:
        await ctx.send(sender, outbound(await save_photos(ctx, sender, photos), end=False))
        if not clean(msg.text()):
            return
    if any(selection_of(item).get("action") == "start_trip" for item in msg.content):
        trip = {"stage": "details"}
        await save_trip(ctx, sender, trip, fresh=True)
        await ctx.send(sender, outbound("Yay, that's great! " + trip_question(trip), end=False))
        return
    trip = await load_trip(sender)
    onboarding = trip is not None and trip["stage"] in ("details", "invite")
    if card := trip_card_reply(msg):
        reply, selection = card
        if selection:
            await save_trip(ctx, sender, {"stage": "dates", "end": selection["destination"]}, fresh=True)
            await ctx.send(sender, reply)
            return
        # "Let's plan a trip" shows the card, unless the message also carries trip details to read.
        if not onboarding or not has_details(clean(msg.text()), trip):
            await ctx.send(sender, reply)
            return
    text = incoming_text(msg)
    if not text:
        return
    if trip and trip["stage"] == "dates" and choose(text) in ("", "Trip"):
        # "Nov 14 to 16, from San Jose with Jordan": the dates are the part before from/with.
        split = re.search(r"[\s,]*\b(?:from|with)\b", text, re.I)
        dates, rest = (text[: split.start()], text[split.start() :].strip(" ,")) if split else (text, "")
        dates = dates.strip(" ,.")
        if not DATEISH.search(dates):
            # "Unistudy is coming with me" is not a date: read it as trip details instead.
            dates, rest = "", text
        if dates:
            trip["dates"], trip["stage"] = dates, "details"
        elif has_details(rest, trip):
            trip["stage"] = "details"
        await save_trip(ctx, sender, trip)
        if rest and has_details(rest, trip):
            await plan_trip(ctx, sender, rest, loose=True)
            if not dates:
                await ctx.send(sender, outbound("And what dates are you thinking?", end=False))
        elif dates:
            await ctx.send(sender, outbound(f"{trip['end']}, {dates}. " + trip_question(trip), end=False))
        else:
            await ctx.send(sender, outbound(f"What dates work for {trip['end']}? Like: Nov 14 to 16, or this weekend.", end=False))
        return
    ready = READY.search(plain(text).lower())
    if trip is None and ready:
        # Convex was unreachable, so fall back to the trip waiting for its group in memory.
        trip_id = next((key for key, value in reversed(crews.items()) if value.get("stage") == "invite"), None)
        if trip_id:
            chats[sender], trip = trip_id, crews[trip_id]
    if trip and trip["stage"] == "invite" and ready:
        trip["stage"] = "rolling"
        await save_trip(ctx, sender, trip)
        await ctx.send(sender, outbound(trip_welcome(trip), end=False))
        return
    if trip and trip["stage"] == "details":
        if has_details(text, trip) or choose(text) in ("", "Trip"):
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

AGENTS = (captain, droid, chef, pit, lifeline, waiter, cashier, ledger, stays, guide, planner, curator)


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
