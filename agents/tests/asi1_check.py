"""Talk to Atlas through ASI:One itself, the way a judge would.

Uses ASI:One planner mode, which discovers and messages Agentverse agents. Atlas's address is passed
in `agents`, so the planner calls it directly. Each step prints which agent ASI:One used, what it sent,
and what came back. Needs ASI1_API_KEY in .env (asi1.ai/developer) and the agents running.

    .venv\\Scripts\\python.exe agents\\tests\\asi1_check.py ["one prompt" ...]
"""

import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

ATLAS = "agent1qvh68avajf0d6sz4ljuukz7umptsefk7dj4lhpqpvm4zx88z272h6aqp3cc"
PROMPTS = sys.argv[1:] or [
    "@atlas-guide Let's plan a trip: road trip from San Jose to Big Sur with Jordan and Priya",
    "@atlas-guide we're all in",
    "@atlas-guide where should we stay?",
    "@atlas-guide plan our days",
    "@atlas-guide verify agents",
]


def merge(into: dict, update: dict):
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(into.get(key), dict):
            merge(into[key], value)
        else:
            into[key] = value


def agents_used(plan: dict) -> list[str]:
    seen = []
    for phase in (plan.get("phases") or {}).values():
        for task in (phase.get("tasks") or {}).values():
            for key in ("agent", "selected_agent", "agent_address", "address"):
                value = task.get(key)
                if isinstance(value, dict):
                    value = value.get("name") or value.get("address")
                if value and value not in seen:
                    seen.append(str(value))
    return seen


def ask(client: httpx.Client, key: str, session: str, messages: list[dict]) -> tuple[str, dict]:
    body = {"model": "asi1", "messages": messages, "planner_mode": True, "agents": [ATLAS], "stream": True}
    headers = {"Authorization": f"Bearer {key}", "x-session-id": session, "Content-Type": "application/json"}
    text, plan = [], {}
    with client.stream("POST", "https://api.asi1.ai/v1/chat/completions", json=body, headers=headers) as response:
        if response.status_code >= 400:
            raise RuntimeError(f"ASI:One returned {response.status_code}: {response.read().decode()[:400]}")
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            with_json = json.loads(data)
            if with_json.get("metadata", {}).get("type") == "plan_state":
                merge(plan, with_json["metadata"])
            for choice in with_json.get("choices") or []:
                text.append((choice.get("delta") or {}).get("content") or "")
    return "".join(text), plan


def main():
    key = os.getenv("ASI1_API_KEY", "").strip()
    if not key:
        raise SystemExit("Set ASI1_API_KEY in .env first. Create one at https://asi1.ai/developer.")
    session = str(uuid.uuid4())
    messages: list[dict] = []
    with httpx.Client(timeout=httpx.Timeout(600, connect=20)) as client:
        for prompt in PROMPTS:
            messages.append({"role": "user", "content": prompt})
            started = time.time()
            print(f"\n>>> {prompt}", flush=True)
            reply, plan = ask(client, key, session, messages)
            print(f"<<< ({time.time() - started:.0f}s, plan {plan.get('plan_status', '?')}) {reply[:1500]}", flush=True)
            used = agents_used(plan)
            print(f"    agents: {', '.join(used) or 'none reported'}"
                  f"{'  (Atlas called)' if any(ATLAS in a or 'Atlas' in a for a in used) else ''}", flush=True)
            messages.append({"role": "assistant", "content": reply})


if __name__ == "__main__":
    main()
