"""Trip planner card for ASI:One.

Say "Let's plan a trip" and this agent answers with an "Explore the Area" custom card
(hero image, category badges, and a list of destinations). Picking a destination sends
back {"content_id", "category", "destination"} and the agent asks for travel dates.

Run on its own:      .venv\\Scripts\\python.exe agents\\trip_agent.py
Run inside Detour:   agents/crew.py imports trip_card_reply() so Atlas
                     shows the same card without a second Agentverse agent.
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    MetadataContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.chat.cards import extract_card_response, validate_card_payload

# Anyone who knows the seed controls the agent's address. Replace it before deploying.
TRIP_AGENT_SEED = "replace-this-with-a-long-random-seed"
TRIP_AGENT_PORT = 8010

HERO_IMAGE = "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1080&q=80"

CATEGORIES = ("Invite friends", "Vote on stays", "Things to do", "Day-by-day plan", "Split payments")

# Each destination is one gate on the boarding pass. The selection JSON a row sends back is built
# from content_id, category, and destination only.
DESTINATIONS = (
    {
        "content_id": "big_sur_drive",
        "category": "coastal_drive",
        "destination": "Big Sur",
        "gate": "GATE 1",
        "code": "BSR",
        "blurb": "Bixby Bridge, redwoods, and cliffs along Highway 1.",
        "drive": "3 hr from SF",
        "vibe": "Cliffs and redwoods",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Bixby_Creek_Bridge%2C_California%2C_USA_-_May_2013.jpg/330px-Bixby_Creek_Bridge%2C_California%2C_USA_-_May_2013.jpg",
    },
    {
        "content_id": "santa_cruz_coast",
        "category": "beach_town",
        "destination": "Santa Cruz",
        "gate": "GATE 2",
        "code": "SCZ",
        "blurb": "Boardwalk, surf breaks, and Natural Bridges at sunset.",
        "drive": "1.5 hr from SF",
        "vibe": "Surf and boardwalk",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/2025-08-11_16_34_37_The_beach_and_the_last_remaining_natural_bridge_at_Natural_Bridges_State_Beach_in_Santa_Cruz%2C_Santa_Cruz_County%2C_California.jpg/330px-2025-08-11_16_34_37_The_beach_and_the_last_remaining_natural_bridge_at_Natural_Bridges_State_Beach_in_Santa_Cruz%2C_Santa_Cruz_County%2C_California.jpg",
    },
    {
        "content_id": "san_francisco_city",
        "category": "city",
        "destination": "San Francisco",
        "gate": "GATE 3",
        "code": "SFO",
        "blurb": "Golden Gate views, Ferry Building food, and Presidio trails.",
        "drive": "City weekend",
        "vibe": "Food and fog",
        "image": "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=320&q=80",
    },
)
BY_ID = {item["content_id"]: item for item in DESTINATIONS}
START_TRIP = {"action": "start_trip"}


def selection_for(item: dict) -> dict:
    return {key: item[key] for key in ("content_id", "category", "destination")}


def badge(label: str, variant: str = "info") -> dict:
    return {"type": "badge", "label": label, "variant": variant}


def row(*children: dict, gap: int = 8) -> dict:
    return {"type": "group", "direction": "row", "gap": gap, "children": list(children)}


def column(*children: dict, gap: int = 4) -> dict:
    return {"type": "group", "direction": "column", "gap": gap, "children": list(children)}


def destination_row(item: dict) -> dict:
    # list item > row (thumbnail + column) > column (gate, name, blurb, badges)
    return {
        "children": [
            row(
                {"type": "image", "src": item["image"], "alt": item["destination"]},
                column(
                    {"type": "text", "value": f"{item['gate']}  ·  {item['code']}", "style": "muted"},
                    {"type": "heading", "value": item["destination"], "level": 3},
                    {"type": "text", "value": item["blurb"], "style": "body"},
                    row(badge(item["drive"]), badge(item["vibe"], "success"), gap=6),
                ),
                gap=12,
            )
        ],
        "action": {"selection": selection_for(item)},
    }


# A boarding pass for the group. Depth: section(1) > list(2) > row(3) > column(4) > row(5) > badge(6). The limit is 8.
CARD_PAYLOAD = {
    "root": {
        "type": "section",
        "title": "DETOUR  ·  BOARDING PASS",
        "subtitle": "One ticket for the whole crew. Plan together, vote together, go.",
        "children": [
            {"type": "image", "src": HERO_IMAGE, "alt": "A van on an open road", "aspect_ratio": "16:7"},
            row(
                column(
                    {"type": "text", "value": "FROM", "style": "muted"},
                    {"type": "heading", "value": "You", "level": 2},
                ),
                column(
                    {"type": "text", "value": "  ", "style": "muted"},
                    {"type": "heading", "value": "⟶", "level": 2},
                ),
                column(
                    {"type": "text", "value": "TO", "style": "muted"},
                    {"type": "heading", "value": "Pick a gate", "level": 2},
                ),
                column(
                    {"type": "text", "value": "CREW", "style": "muted"},
                    {"type": "heading", "value": "You + friends", "level": 2},
                ),
                gap=20,
            ),
            row(*(badge(label) for label in CATEGORIES), gap=6),
            {"type": "divider"},
            {"type": "heading", "value": "Choose your gate", "level": 2},
            {"type": "list", "items": [destination_row(item) for item in DESTINATIONS]},
            {"type": "divider"},
            {"type": "text", "value": "Somewhere else in mind? Start a trip and tell me where, when, and who's coming.",
             "style": "muted"},
            row(
                {"type": "button", "label": "Start my trip", "primary": True, "action": {"selection": START_TRIP}},
                {"type": "button", "label": "Take me to Big Sur",
                 "action": {"selection": selection_for(DESTINATIONS[0])}},
            ),
            {"type": "text", "value": "SEAT: ANY  ·  BOARDING: NOW  ·  ASI:ONE GROUP CHAT", "style": "emphasis"},
        ],
    }
}

# Fails at import if the card breaks the ASI:One custom-card schema or depth limit.
validate_card_payload("custom", CARD_PAYLOAD)
CARD_JSON = json.dumps(CARD_PAYLOAD)
if len(CARD_JSON.encode()) >= 64 * 1024:
    raise ValueError("card_payload must stay under 64 KB")

# Every value is a string. is_terminal is left out because the card needs a tap.
CARD_METADATA = {
    "card_protocol_version": "1",
    "requires_card_interaction": "true",
    "card_kind": "custom",
    "preferred_drawer_width_px": "540",
    "card_payload": CARD_JSON,
}

TRIP_REQUEST = re.compile(r"\b(?:let'?s\s+)?plan(?:ning)?\s+(?:a\s+)?trip\b|\btravel(?:l?ing|s)?\b|\bvacation\b")
JSON_OBJECT = re.compile(r"\{[^{}]*\}")
CONTENT_ID = re.compile(r"\bcontent[_ ]id\b\W*([A-Za-z0-9_-]+)", re.I)
FALLBACK = 'Say "Let\'s plan a trip" and I\'ll show you places to explore.'


def chat(*content) -> ChatMessage:
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=list(content))


def wants_trip(text: str) -> bool:
    text = text.replace("\u2019", "'").lower()
    text = re.sub(r"^@\S+\s*|\b(?:travel captain|yatra|atlas)\b", " ", text)
    return bool(TRIP_REQUEST.search(text))


def resolve(data: dict) -> dict:
    """Fill category and destination from the catalog when the selection leaves them out."""
    content_id = str(data["content_id"])
    known = BY_ID.get(content_id, {})
    return {
        "content_id": content_id,
        "category": str(data.get("category") or known.get("category", "")),
        "destination": str(data.get("destination") or known.get("destination") or content_id.replace("_", " ").title()),
    }


def parse_selection(text: str) -> dict | None:
    """Read a card selection from direct JSON or from a planner's natural-language relay."""
    text = text.strip()
    for candidate in (text, *JSON_OBJECT.findall(text)):
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("content_id"):
            return resolve(data)
    match = CONTENT_ID.search(text)
    content_id = match.group(1) if match else next(
        (cid for cid in BY_ID if re.search(rf"\b{cid}\b", text, re.I)), None
    )
    if not content_id:
        return None
    data = {"content_id": content_id}
    for key in ("category", "destination"):
        if found := re.search(rf"\b{key}\b\W*([^,;\n\"'{{}}]+)", text, re.I):
            data[key] = found.group(1).strip(" .!?")
    return resolve(data)


def selection_in(msg: ChatMessage) -> dict | None:
    """ASI:One sends taps as MetadataContent; some clients send the JSON as TextContent."""
    for item in msg.content:
        if isinstance(item, MetadataContent):
            response = extract_card_response(item)
            if response and response.selection and response.selection.get("content_id"):
                return resolve(response.selection)
        elif isinstance(item, TextContent) and (found := parse_selection(item.text)):
            return found
    return None


def card_message() -> ChatMessage:
    return chat(
        TextContent(type="text", text="Your Detour boarding pass: pick a gate, or tap Start my trip."),
        MetadataContent(type="metadata", metadata=CARD_METADATA),
    )


def chosen_message(selection: dict) -> ChatMessage:
    return chat(
        TextContent(
            type="text",
            text=f"Great choice. I selected {selection['destination']}. What dates would you like to travel?",
        )
    )


def trip_card_reply(msg: ChatMessage) -> tuple[ChatMessage, dict | None] | None:
    """The card or the dates question for this message, plus the selection if there was one."""
    if selection := selection_in(msg):
        return chosen_message(selection), selection
    text = " ".join(item.text for item in msg.content if isinstance(item, TextContent))
    if wants_trip(text):
        return card_message(), None
    return None


chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
    reply = trip_card_reply(msg)
    if reply is None:
        await ctx.send(sender, chat(TextContent(type="text", text=FALLBACK)))
        return
    message, selection = reply
    if selection:
        ctx.logger.info("Selected %s", json.dumps(selection))
    await ctx.send(sender, message)


@chat_proto.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info("Ack from %s", sender)


def main():
    asyncio.set_event_loop(asyncio.new_event_loop())
    agent = Agent(
        name="Trip Planner",
        seed=TRIP_AGENT_SEED,
        port=TRIP_AGENT_PORT,
        mailbox=True,
        network="testnet",
        publish_agent_details=True,
    )
    agent.include(chat_proto, publish_manifest=True)
    if TRIP_AGENT_SEED.startswith("replace-this"):
        print("Warning: TRIP_AGENT_SEED is still the placeholder. Replace it before sharing this agent.", flush=True)
    print(f"Trip Planner address: {agent.address}", flush=True)
    agent.run()


if __name__ == "__main__":
    main()
