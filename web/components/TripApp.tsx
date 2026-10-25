"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import usePresence from "@convex-dev/presence/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { OrderDesk } from "@/components/OrderDesk";

type Place = {
  name: string;
  detail: string;
  rating: string;
  phone: string;
  status: string;
  buzz?: string;
  miles?: number;
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

const AGENT_NAMES: Record<string, string> = {
  "Travel Captain": "Atlas",
  "Personal Chef": "BiteScout",
  "Pit Stop": "FuelFox",
  Lifeline: "CareRoute",
  Waiter: "MenuScout",
  Cashier: "PayPilot",
  Stays: "StayScout",
  Guide: "Local Guide",
  Planner: "Itinerary",
  Curator: "Curator",
};

export function TripApp() {
  // Every panel below is a live Convex query: when an agent writes, the page updates with no refresh.
  const trip = useQuery(api.trips.current);
  const tripId = trip?._id ?? null;
  return <Board trip={trip ?? null} tripId={tripId} loading={trip === undefined} />;
}

function Board({ trip, tripId, loading }: { trip: Doc<"trips"> | null; tripId: Id<"trips"> | null; loading: boolean }) {
  const skip = tripId ? { tripId } : "skip";
  const messages = useQuery(api.messages.list, skip) ?? [];
  const logs = useQuery(api.monitor.list, skip) ?? [];
  const orders = useQuery(api.orders.list, skip) ?? [];
  const picks = useQuery(api.options.board, skip);
  const castVote = useMutation(api.options.vote);
  const ensureTrip = useMutation(api.trips.ensureDemo);

  const people = trip?.people?.length ? trip.people : [trip?.leadName || "Alex", trip?.driverName || "Jordan"];
  const [viewer, setViewer] = useState("");
  const name = viewer || people[0] || "Guest";
  const presence = usePresence(api.presence, tripId ? `trip-${tripId}` : "trip-none", name);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const [speakError, setSpeakError] = useState("");
  const [voteError, setVoteError] = useState("");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spokenId = useRef<string>("");
  const drivingRef = useRef(profile.driving);
  drivingRef.current = profile.driving;

  useEffect(() => {
    if (!loading && !trip) void ensureTrip({});
  }, [loading, trip, ensureTrip]);

  const latestMessageId = messages[messages.length - 1]?._id ?? "";

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest) return;
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
        body: JSON.stringify({ tripId, author: name, text: message }),
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

  async function vote(kind: "stay" | "activity", option: string) {
    if (!tripId) return;
    setVoteError("");
    const result = await castVote({ tripId, kind, name: option, voter: `board:${name}` });
    if (!result.ok) setVoteError(result.error);
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
    const scope = window as Window & {
      SpeechRecognition?: new () => BrowserRecognizer;
      webkitSpeechRecognition?: new () => BrowserRecognizer;
    };
    const Ctor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
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

  const latestAgent = [...messages].reverse().find((message) => message.role === "agent");
  const chefMessage = [...messages].reverse().find((message) => message.author === "Personal Chef" && message.placesJson);
  const chefPlaces = parsePlaces(chefMessage?.placesJson);
  const latestMenu = parseMenu([...messages].reverse().find((message) => message.menuJson)?.menuJson);
  const online = (presence ?? []).filter((person) => person.online);
  const newest = messages[messages.length - 1];
  const announcement = newest ? `${displayName(newest.author)}: ${newest.body}` : "";

  return (
    <div
      data-low-vision={profile.lowVision}
      data-colorblind={profile.colorblind}
      data-plain={profile.plain}
      data-motion={profile.reduceMotion ? "reduce" : "ok"}
      className="min-h-screen"
      style={profile.lowVision ? { background: "#ffffff", color: "#000000", fontSize: "20px" } : undefined}
    >
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-[0.2em] text-[var(--teal)]">DETOUR · LIVE TRIP BOARD</p>
          <h1 className="text-3xl font-semibold">
            {trip ? trip.name || `${trip.origin} to ${trip.destination}` : "Loading the trip"}
          </h1>
          <p className="mt-1 text-[var(--soft)]">
            {trip
              ? [trip.dates, people.length ? `with ${people.join(", ")}` : "", stageLabel(trip.stage)]
                  .filter(Boolean)
                  .join(" · ")
              : "Connecting to Convex."}
          </p>
          {trip?.positionLabel ? <p className="mt-1 text-[var(--muted)]">Searching near: {trip.positionLabel}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <label className="grid gap-1 text-sm font-semibold">
            I am
            <select
              value={name}
              onChange={(event) => setViewer(event.target.value)}
              className="btn-secondary min-h-11 rounded-xl px-3"
            >
              {[...new Set([...people, "Guest"])].map((person) => (
                <option key={person}>{person}</option>
              ))}
            </select>
          </label>
          <p className="text-sm" aria-live="polite">
            On the board now: {online.length ? online.map((person) => person.userId).join(", ") : "just you"}
          </p>
        </div>
      </header>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.9fr)]">
        <section aria-label="Trip chat" className="flex max-h-[calc(100vh-9rem)] flex-col gap-3">
          <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-label="Messages">
            {messages.map((message) => (
              <li
                key={message._id}
                className={`rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 ${
                  message.role === "agent" ? "border-l-4 border-l-[var(--teal)]" : ""
                }`}
              >
                <p className="text-sm font-semibold">
                  {displayName(message.author)}{" "}
                  <span className="font-normal text-[var(--muted)]">
                    {message.role === "human" ? "in the trip" : message.role}
                  </span>
                </p>
                {profile.driving && message.role === "agent" ? (
                  <>
                    <p className="sr-only">{message.body}</p>
                    <p className="mt-2">Voice is playing this result. Say stop, or press Stop.</p>
                  </>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap">{message.body}</p>
                )}
                {!profile.driving && message.placesJson ? (
                  <PlaceList json={message.placesJson} plain={profile.plain} />
                ) : null}
              </li>
            ))}
            {pendingText ? (
              <li className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
                <p className="text-sm font-semibold">{name} in the trip</p>
                <p className="mt-2">{pendingText}</p>
                <p className="mt-2 font-semibold">Droid is reading this and choosing one specialist.</p>
              </li>
            ) : null}
          </ul>

          <form onSubmit={onSubmit} className="grid gap-3 border-t border-[var(--line)] bg-[var(--paper)] py-3">
            <div className="flex flex-wrap gap-2">
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
                placeholder={`Message the trip as ${name}`}
                className="btn-secondary min-h-11 flex-1 rounded-xl px-3"
              />
              <button type="submit" disabled={sending || !tripId} className="btn-primary min-h-11 rounded-xl px-4 font-semibold">
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
          <Itinerary trip={trip} />
          <Picks
            title="Where we stay"
            empty="Ask Atlas: where should we stay?"
            rows={picks?.stays ?? []}
            me={`board:${name}`}
            onVote={(option) => void vote("stay", option)}
          />
          <Picks
            title="Things to do"
            empty="Ask Atlas: things to do there."
            rows={picks?.activities ?? []}
            me={`board:${name}`}
            onVote={(option) => void vote("activity", option)}
          />
          {voteError ? (
            <p role="alert" className="font-semibold">
              {voteError}
            </p>
          ) : null}
          <OrderDesk
            tripId={tripId}
            places={chefPlaces}
            menu={latestMenu}
            orders={orders}
            leadName={trip?.leadName ?? "Alex"}
            driverName={trip?.driverName || "Jordan"}
          />
          <fieldset className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <legend className="px-1 font-semibold">Accessibility</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <Toggle label="Driving mode" pressed={profile.driving} onClick={() => setProfile((c) => ({ ...c, driving: !c.driving }))} />
              <Toggle label="Low vision" pressed={profile.lowVision} onClick={() => setProfile((c) => ({ ...c, lowVision: !c.lowVision }))} />
              <Toggle label="Colorblind-safe" pressed={profile.colorblind} onClick={() => setProfile((c) => ({ ...c, colorblind: !c.colorblind }))} />
              <Toggle label="Plain language" pressed={profile.plain} onClick={() => setProfile((c) => ({ ...c, plain: !c.plain }))} />
              <Toggle label="Reduced motion" pressed={profile.reduceMotion} onClick={() => setProfile((c) => ({ ...c, reduceMotion: !c.reduceMotion }))} />
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
              <button type="button" className="btn-secondary min-h-11 rounded-xl px-4 font-semibold" onClick={stop}>
                Stop
              </button>
              <button type="button" className="btn-secondary min-h-11 rounded-xl px-4 font-semibold" onClick={listen}>
                Reply by voice
              </button>
            </div>
            {speakError ? (
              <p role="alert" className="mt-2 font-semibold">
                {speakError}
              </p>
            ) : null}
          </fieldset>

          <details className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <summary className="cursor-pointer font-semibold">Agent log ({logs.length})</summary>
            <ul className="mt-3 flex flex-col gap-3">
              {logs.map((log) => (
                <li key={log._id}>
                  <p className="font-semibold">
                    {statusLabel(log.status)} · {displayName(log.agent)} · {log.intent}
                  </p>
                  <p>{log.plan}</p>
                  <p className="text-sm text-[var(--muted)]">{log.detail}</p>
                </li>
              ))}
              {logs.length === 0 ? <li>No messages have been routed yet.</li> : null}
            </ul>
          </details>
        </aside>
      </div>
      {tripId ? <Album tripId={tripId} name={name} /> : null}
      <IdCards />
    </div>
  );
}

// The photos the group shared, and the latest post the Curator made from them.
function Album({ tripId, name }: { tripId: Id<"trips">; name: string }) {
  const photos = useQuery(api.photos.album, { tripId }) ?? [];
  const posts = useQuery(api.photos.posts, { tripId }) ?? [];
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const latest = posts[0];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    let done = 0;
    for (const file of Array.from(files)) {
      setBusy(`Adding ${done + 1} of ${files.length}`);
      const form = new FormData();
      form.append("photo", file);
      form.append("sharedBy", name);
      form.append("tripId", tripId);
      const response = await fetch("/api/photos", { method: "POST", body: form }).catch(() => null);
      if (!response?.ok) {
        const payload = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
        setError(payload?.error || "A photo did not upload.");
      }
      done += 1;
    }
    setBusy("");
  }

  async function curatePost() {
    setBusy("The Curator is picking photos");
    setError("");
    const response = await fetch("/api/curate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId, text: "Curate a post from our trip photos." }),
    }).catch(() => null);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(payload?.error || "The post could not be made.");
    }
    setBusy("");
  }

  return (
    <section aria-label="Trip album" className="border-t border-[var(--line)] px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Trip album</h2>
          <p className="text-[var(--muted)]">
            Share photos with Atlas in ASI:One, or add them here. Say &quot;curate a post&quot; and the Curator picks the
            set that looks best together.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary inline-flex min-h-11 cursor-pointer items-center rounded-xl px-4 font-semibold">
            Add photos
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => void upload(event.target.files)} />
          </label>
          <button
            type="button"
            className="btn-primary min-h-11 rounded-xl px-4 font-semibold"
            disabled={Boolean(busy) || photos.length === 0}
            onClick={() => void curatePost()}
          >
            Curate a post
          </button>
        </div>
      </div>
      {busy ? <p className="mt-2 font-semibold" aria-live="polite">{busy}…</p> : null}
      {error ? <p role="alert" className="mt-2 font-semibold">{error}</p> : null}

      {latest ? (
        <article className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--teal)]">LATEST POST · {latest.theme.toUpperCase()}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {latest.photos.map((photo, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo._id}
                src={photo.url}
                alt={`Post photo ${index + 1}, ${photo.look.theme}`}
                className={`aspect-square w-full rounded-xl object-cover ${index === 0 ? "col-span-2 row-span-2" : ""}`}
              />
            ))}
          </div>
          <p className="mt-3 text-lg">{latest.caption}</p>
          <p className="mt-1 text-[var(--teal)]">{latest.hashtags.join(" ")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{latest.source}</p>
        </article>
      ) : null}

      <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {photos.map((photo) => {
          const inPost = latest?.photoIds.includes(photo._id);
          return (
            <li key={photo._id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={`${photo.look.theme} photo shared by ${photo.sharedBy}`} className="aspect-square w-full rounded-xl object-cover" />
              <span className="absolute inset-x-1 bottom-1 truncate rounded-lg bg-black/70 px-2 py-0.5 text-[11px] text-white">
                {inPost ? "In post · " : ""}
                {photo.look.theme} · {photo.look.score.toFixed(1)}
              </span>
              <span className="absolute right-1 top-1 flex gap-0.5" aria-hidden>
                {photo.look.palette.slice(0, 3).map((color) => (
                  <span key={color} className="h-3 w-3 rounded-full border border-white/60" style={{ background: color }} />
                ))}
              </span>
            </li>
          );
        })}
        {photos.length === 0 ? <li className="col-span-full text-[var(--muted)]">No photos yet.</li> : null}
      </ul>
    </section>
  );
}

// Every agent's ID card: who it is (its Fetch address is its public key) and what it has signed.
function IdCards() {
  const passports = useQuery(api.actions.passports) ?? [];
  const recent = useQuery(api.actions.recent, { limit: 8 }) ?? [];
  if (passports.length === 0) return null;
  const order = ["Atlas", "Relay", "StayScout", "Local Guide", "Itinerary", "Curator", "BiteScout", "FuelFox", "CareRoute", "MenuScout", "PayPilot", "Ledger"];
  const sorted = [...passports].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return (
    <section aria-label="Agent ID cards" className="border-t border-[var(--line)] px-5 py-5">
      <h2 className="text-xl font-semibold">Agent ID cards</h2>
      <p className="text-[var(--muted)]">
        Each agent signs every action with its own key, and each action has a key so it happens once. Say
        &quot;verify agents&quot; in ASI:One to check every signature.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sorted.map((agent) => (
          <li
            key={agent.address}
            className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
          >
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-1.5"
              style={{ background: `linear-gradient(90deg, ${hue(agent.address, 0)}, ${hue(agent.address, 7)}, ${hue(agent.address, 13)})` }}
            />
            <div className="flex items-start gap-3">
              <Identicon seed={agent.address} />
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">DETOUR AGENT ID</p>
                <p className="text-lg font-semibold leading-tight">{agent.name}</p>
                <p className="text-sm text-[var(--teal)]">@{agent.handle}</p>
              </div>
            </div>
            <p className="mt-2 text-sm">{agent.role}</p>
            <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">{agent.address}</p>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              <Stat label="Signed" value={agent.actions} />
              <Stat label="Repeats blocked" value={agent.repeatsBlocked} />
              <Stat label="Errors" value={agent.errors} />
              <Stat label="Median reply" value={agent.medianMs === null ? "–" : `${(agent.medianMs / 1000).toFixed(1)}s`} />
            </dl>
            <p className="mt-2 text-xs text-[var(--muted)]">{agent.protocols.join(" · ")}</p>
            {agent.last ? (
              <p className="mt-1 truncate font-mono text-xs" title={agent.last.signature}>
                Last signature {agent.last.signature.slice(0, 22)}…
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">No actions yet</p>
            )}
          </li>
        ))}
      </ul>
      {recent.length ? (
        <details className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <summary className="cursor-pointer font-semibold">Signed action log</summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {recent.map((action) => (
              <li key={action._id}>
                <span className="font-semibold">{action.agent}</span> · {action.kind} · {action.text.slice(0, 90)}
                <span className="block font-mono text-xs text-[var(--muted)]">
                  {new Date(action.at).toLocaleTimeString()} · {action.signature.slice(0, 30)}…
                  {action.repeats ? ` · blocked ${action.repeats} repeat${action.repeats === 1 ? "" : "s"}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-2">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function hue(seed: string, offset: number) {
  const code = seed.charCodeAt((seed.length - 1 - offset) % seed.length) * 37 + offset * 53;
  return `hsl(${code % 360} 85% 60%)`;
}

// A 5x5 mirrored pattern drawn from the agent's address, so every ID card looks different.
function Identicon({ seed }: { seed: string }) {
  const bits = Array.from({ length: 15 }, (_, index) => seed.charCodeAt(10 + index) % 2 === 0);
  const cells: boolean[] = [];
  for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
    const left = bits.slice(rowIndex * 3, rowIndex * 3 + 3);
    cells.push(...left, left[1], left[0]);
  }
  const color = hue(seed, 3);
  return (
    <div aria-hidden className="grid h-12 w-12 shrink-0 grid-cols-5 gap-px rounded-lg bg-[var(--field)] p-1">
      {cells.map((on, index) => (
        <span key={index} style={{ background: on ? color : "transparent" }} className="rounded-[2px]" />
      ))}
    </div>
  );
}

function Itinerary({ trip }: { trip: Doc<"trips"> | null }) {
  const days = trip?.itinerary ?? [];
  return (
    <section aria-label="Itinerary" className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <h2 className="font-semibold">Day-by-day plan</h2>
      {days.length === 0 ? (
        <p className="mt-2 text-[var(--muted)]">Say &quot;plan our days&quot; to Atlas and the plan appears here.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-3">
          {days.map((day) => (
            <li key={day.title}>
              <p className="font-semibold text-[var(--teal)]">{day.title}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {day.stops.map((stop, index) => (
                  <li key={`${stop.time}-${index}`}>
                    <span className="font-semibold">{stop.time}</span> · {stop.place}
                    {stop.note ? <span className="text-[var(--muted)]"> · {stop.note}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {trip?.itinerarySource ? <p className="mt-2 text-sm text-[var(--muted)]">{trip.itinerarySource}</p> : null}
    </section>
  );
}

type PickRow = { _id: string; name: string; detail: string; rating: string; miles?: number; votes: number; voters: string[] };

function Picks({
  title,
  empty,
  rows,
  me,
  onVote,
}: {
  title: string;
  empty: string;
  rows: PickRow[];
  me: string;
  onVote: (option: string) => void;
}) {
  const most = Math.max(1, ...rows.map((row) => row.votes));
  return (
    <section aria-label={title} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <h2 className="font-semibold">{title}: group vote</h2>
      {rows.length === 0 ? <p className="mt-2 text-[var(--muted)]">{empty}</p> : null}
      <ul className="mt-2 flex flex-col gap-2">
        {rows.slice(0, 6).map((row, index) => {
          const mine = row.voters.includes(me);
          return (
            <li key={row._id} className="rounded-xl border border-[var(--line)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {index === 0 && row.votes > (rows[1]?.votes ?? 0) ? "Leading: " : ""}
                    {row.name}
                  </p>
                  <p className="text-sm text-[var(--muted)]">
                    {[row.rating, typeof row.miles === "number" ? `${row.miles} mi` : ""].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  aria-pressed={mine}
                  onClick={() => onVote(row.name)}
                  className={`${mine ? "btn-primary" : "btn-secondary"} min-h-11 shrink-0 rounded-xl px-3 font-semibold`}
                >
                  {mine ? "Your vote" : "Vote"}
                </button>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[var(--line)]" aria-hidden>
                <div
                  className="h-2 rounded-full bg-[var(--teal)] transition-all"
                  style={{ width: `${(row.votes / most) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-sm">
                {row.votes} vote{row.votes === 1 ? "" : "s"}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlaceList({ json, plain }: { json: string; plain: boolean }) {
  const places = parsePlaces(json);
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
              {typeof place.miles === "number" ? ` ${place.miles} mi away.` : ""}
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

function Toggle({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className="btn-secondary min-h-11 rounded-xl px-3 font-semibold">
      {label}: {pressed ? "On" : "Off"}
    </button>
  );
}

function displayName(author: string) {
  return AGENT_NAMES[author] ?? author;
}

function stageLabel(stage: string | undefined) {
  if (stage === "details" || stage === "dates") return "Planning";
  if (stage === "invite") return "Waiting for friends to join";
  if (stage === "rolling") return "On the road";
  return "";
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
