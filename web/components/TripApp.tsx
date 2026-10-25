"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { OrderDesk } from "@/components/OrderDesk";

type Place = {
  name: string;
  detail: string;
  rating: string;
  phone: string;
  status: string;
  buzz?: string;
};

type Dish = { name: string; price: number; note: string };

type Profile = {
  driving: boolean;
  lowVision: boolean;
  colorblind: boolean;
  plain: boolean;
  reduceMotion: boolean;
};

const EMPTY_PROFILE: Profile = {
  driving: false,
  lowVision: false,
  colorblind: false,
  plain: false,
  reduceMotion: false,
};

type TripPayload = {
  tripId: Id<"trips">;
  trip: {
    origin: string;
    destination: string;
    leadName: string;
    driverName: string;
    positionLabel: string;
  } | null;
  messages: Array<{
    _id: string;
    author: string;
    role: "human" | "agent" | "system";
    body: string;
    placesJson?: string;
    menuJson?: string;
  }>;
  logs: Array<{
    _id: string;
    status: string;
    agent: string;
    intent: string;
    plan: string;
    detail: string;
  }>;
  orders: Array<{
    _id: string;
    placeName: string;
    member: string;
    item: string;
    price: number;
  }>;
  route: { summary: string; town: string } | null;
};

export function TripApp() {
  const [payload, setPayload] = useState<TripPayload | null>(null);
  const [author, setAuthor] = useState("Alex");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const [speakError, setSpeakError] = useState("");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [announcement, setAnnouncement] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spokenId = useRef<string>("");
  const drivingRef = useRef(profile.driving);
  drivingRef.current = profile.driving;

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/trip", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not open the local trip.");
        const next = (await response.json()) as TripPayload;
        if (!cancelled) setPayload(next);
      } catch {
        if (!cancelled) setError("Could not open the local trip.");
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const trip = payload?.trip ?? null;
  const tripId = payload?.tripId ?? null;
  const messages = payload?.messages ?? [];
  const logs = payload?.logs ?? [];

  const latestMessageId = messages[messages.length - 1]?._id ?? "";

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest) return;
    setAnnouncement(`${latest.author}: ${latest.body}`);
    if (!drivingRef.current || latest.role !== "agent" || spokenId.current === latest._id) return;
    spokenId.current = latest._id;
    void speak(latest.body);
    // Re-run only when a new message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestMessageId]);

  async function send(text: string) {
    const message = text.trim();
    if (!tripId || !message || sending) return;
    setSending(true);
    setPendingText(message);
    setDraft("");
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, author, text }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) setError(payload.error || "The monitor could not finish.");
    } catch {
      setError("The request did not finish. Check that the local app is still running.");
    } finally {
      setSending(false);
      setPendingText("");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  async function speak(text: string) {
    setSpeakError("");
    stop();
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setSpeakError(payload.error || "Cartesia did not return audio.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  }

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
  }

  function listen() {
    const BrowserSpeech = (
      window as Window & {
        SpeechRecognition?: new () => BrowserRecognizer;
        webkitSpeechRecognition?: new () => BrowserRecognizer;
      }
    ).SpeechRecognition;
    const WebkitSpeech = (
      window as Window & { webkitSpeechRecognition?: new () => BrowserRecognizer }
    ).webkitSpeechRecognition;
    const Ctor = BrowserSpeech || WebkitSpeech;
    if (!Ctor) {
      setSpeakError("This browser has no speech recognition. Type the reply instead.");
      return;
    }
    const recognizer = new Ctor();
    recognizer.lang = "en-US";
    recognizer.onresult = (event) => {
      const said = event.results[0][0].transcript.trim();
      if (/stop/i.test(said)) stop();
      else void send(said);
    };
    recognizer.onerror = () => setSpeakError("The microphone did not catch that.");
    recognizer.start();
  }

  const latestAgent = [...(messages ?? [])].reverse().find((message) => message.role === "agent");
  const chefMessage = [...messages].reverse().find((message) => message.author === "Personal Chef" && message.placesJson);
  const chefPlaces = parsePlaces(chefMessage?.placesJson);
  const latestMenu = parseMenu([...messages].reverse().find((message) => message.menuJson)?.menuJson);

  return (
    <div
      data-low-vision={profile.lowVision}
      data-colorblind={profile.colorblind}
      data-plain={profile.plain}
      data-motion={profile.reduceMotion ? "reduce" : "ok"}
      className="min-h-screen"
      style={
        profile.lowVision
          ? { background: "#ffffff", color: "#000000", fontSize: "20px" }
          : undefined
      }
    >
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <header className="border-b border-[var(--line)] px-5 py-4">
        <p className="text-sm font-semibold tracking-[0.2em] text-[var(--teal)]">DETOUR</p>
        <h1 className="text-3xl font-semibold">
          {trip ? `${trip.origin} to ${trip.destination}` : "Loading the trip"}
        </h1>
        <p className="mt-1 text-[var(--soft)]">
          {trip
            ? `${trip.leadName} is the trip lead. ${trip.driverName} is the driver.`
            : "Opening the local trip. If this stays here, refresh the page."}
        </p>
        {payload?.route?.summary ? <p className="mt-1 text-[var(--muted)]">{payload.route.summary}</p> : null}
      </header>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <section aria-label="Trip chat" className="flex max-h-[calc(100vh-9rem)] flex-col gap-3">
          <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-label="Messages">
            {(messages ?? []).map((message) => (
              <li
                key={message._id}
                className={`rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 ${
                  message.role === "agent" ? "border-l-4 border-l-[var(--teal)]" : ""
                }`}
              >
                <p className="text-sm font-semibold">
                  {message.author}{" "}
                  <span className="font-normal text-[var(--muted)]">
                    {message.role === "human" ? "in the trip" : message.role}
                  </span>
                </p>
                {profile.driving && message.role === "agent" ? (
                  <p className="sr-only">{message.body}</p>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap">{message.body}</p>
                )}
                {profile.driving && message.role === "agent" ? (
                  <p className="mt-2">Voice is playing this result. Say stop, or press Stop.</p>
                ) : null}
                {!profile.driving && message.placesJson ? (
                  <PlaceList json={message.placesJson} plain={profile.plain} />
                ) : null}
              </li>
            ))}
            {pendingText ? (
              <li className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
                <p className="text-sm font-semibold">{author} in the trip</p>
                <p className="mt-2">{pendingText}</p>
                <p className="mt-2 font-semibold">
                  Droid is reading this and choosing one specialist.
                </p>
              </li>
            ) : null}
          </ul>

          <form onSubmit={onSubmit} className="grid gap-3 border-t border-[var(--line)] bg-[var(--paper)] py-3">
            <div className="flex flex-wrap gap-2">
              <label className="grid gap-1 text-sm font-semibold">
                Speaking as
                <select
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  className="btn-secondary min-h-11 rounded-xl px-3"
                >
                  <option>Alex</option>
                  <option>Jordan</option>
                </select>
              </label>
              {["I'm starving, breakfast?", "Gas is at 10%", "I feel dizzy"].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="btn-secondary min-h-11 rounded-xl px-3"
                  onClick={() => void send(prompt)}
                  disabled={sending || !tripId}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="message">
                Message the trip
              </label>
              <input
                id="message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Tell the trip what you need"
                className="btn-secondary min-h-11 flex-1 rounded-xl px-3"
              />
              <button
                type="submit"
                disabled={sending || !tripId}
                className="btn-primary min-h-11 rounded-xl px-4 font-semibold"
              >
                {sending ? "Checking" : "Send"}
              </button>
            </div>
            {error ? (
              <p role="alert" className="font-semibold">
                {error}
              </p>
            ) : null}
          </form>
        </section>

        <aside className="flex flex-col gap-3">
          <OrderDesk
            tripId={tripId}
            places={chefPlaces}
            menu={latestMenu}
            orders={payload?.orders ?? []}
            leadName={trip?.leadName ?? "Alex"}
            driverName={trip?.driverName ?? "Jordan"}
          />
          <fieldset className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <legend className="px-1 font-semibold">Accessibility</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <Toggle
                label="Driving mode"
                pressed={profile.driving}
                onClick={() => setProfile((current) => ({ ...current, driving: !current.driving }))}
              />
              <Toggle
                label="Low vision"
                pressed={profile.lowVision}
                onClick={() => setProfile((current) => ({ ...current, lowVision: !current.lowVision }))}
              />
              <Toggle
                label="Colorblind-safe"
                pressed={profile.colorblind}
                onClick={() =>
                  setProfile((current) => ({ ...current, colorblind: !current.colorblind }))
                }
              />
              <Toggle
                label="Plain language"
                pressed={profile.plain}
                onClick={() => setProfile((current) => ({ ...current, plain: !current.plain }))}
              />
              <Toggle
                label="Reduced motion"
                pressed={profile.reduceMotion}
                onClick={() =>
                  setProfile((current) => ({ ...current, reduceMotion: !current.reduceMotion }))
                }
              />
            </div>
            <p className="mt-3 text-sm">Screen reader support stays on. Status uses words, not color alone.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary min-h-11 rounded-xl px-4 font-semibold"
                onClick={() => latestAgent && void speak(latestAgent.body)}
                disabled={!latestAgent}
              >
                Read aloud
              </button>
              <button
                type="button"
                className="btn-secondary min-h-11 rounded-xl px-4 font-semibold"
                onClick={stop}
              >
                Stop
              </button>
              <button
                type="button"
                className="btn-secondary min-h-11 rounded-xl px-4 font-semibold"
                onClick={listen}
              >
                Reply by voice
              </button>
            </div>
            {speakError ? (
              <p role="alert" className="mt-2 font-semibold">
                {speakError}
              </p>
            ) : null}
          </fieldset>

          <details open className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <summary className="cursor-pointer font-semibold">Monitor log</summary>
            <ul className="mt-3 flex flex-col gap-3">
              {(logs ?? []).map((log) => (
                <li key={log._id}>
                  <p className="font-semibold">
                    {statusLabel(log.status)} · {log.agent} · {log.intent}
                  </p>
                  <p>{log.plan}</p>
                  <p className="text-sm text-[var(--muted)]">{log.detail}</p>
                </li>
              ))}
              {logs?.length === 0 ? <li>No messages have been classified yet.</li> : null}
            </ul>
          </details>
        </aside>
      </div>
    </div>
  );
}

function PlaceList({ json, plain }: { json: string; plain: boolean }) {
  let places: Place[] = [];
  try {
    places = JSON.parse(json) as Place[];
  } catch {
    return null;
  }
  return (
    <ol className="mt-3 flex flex-col gap-2">
      {places.map((place, index) => (
        <li key={`${place.name}-${index}`} className="rounded-xl border border-[var(--line)] p-3">
          <p className="font-semibold">
            {index + 1}. {place.name}
          </p>
          {plain ? null : (
            <p>
              {place.status}. {place.rating}. {place.detail}
              {place.buzz ? ` ${place.buzz}.` : ""}
            </p>
          )}
          {place.phone ? (
            <a className="inline-flex min-h-11 items-center underline" href={`tel:${place.phone}`}>
              Call {place.phone}
            </a>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Toggle({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="btn-secondary min-h-11 rounded-xl px-3 font-semibold"
    >
      {label}: {pressed ? "On" : "Off"}
    </button>
  );
}

function parsePlaces(json: string | undefined): Place[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as Place[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseMenu(json: string | undefined) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { placeName?: string; dishes?: Dish[]; note?: string };
    if (!parsed.placeName || !Array.isArray(parsed.dishes)) return null;
    return { placeName: parsed.placeName, dishes: parsed.dishes, note: parsed.note || "" };
  } catch {
    return null;
  }
}

function statusLabel(status: string) {
  if (status === "done") return "Done";
  if (status === "running") return "Running";
  if (status === "skipped") return "Skipped";
  return "Error";
}

type BrowserRecognizer = {
  lang: string;
  start: () => void;
  onresult: (event: { results: Array<Array<{ transcript: string }>> }) => void;
  onerror: () => void;
};
