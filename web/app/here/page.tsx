"use client";

import { useState } from "react";

export default function SharePosition() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function share() {
    if (!navigator.geolocation) {
      setStatus("This browser cannot share a location.");
      return;
    }
    setBusy(true);
    setStatus("Asking the browser for your location...");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const response = await fetch("/api/location", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
        }).catch(() => null);
        setBusy(false);
        setStatus(
          response?.ok
            ? `Location shared (within about ${Math.round(coords.accuracy)} m). Go back to ASI:One and ask again.`
            : "The location could not be saved. Try again.",
        );
      },
      (error) => {
        setBusy(false);
        setStatus(`The browser did not share a location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Share your location with Travel Assist AI</h1>
      <p className="text-sm opacity-80">
        Atlas uses it to find the closest food, gas, and urgent care. It is kept for six hours.
      </p>
      <button
        onClick={share}
        disabled={busy}
        className="rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Sharing..." : "Share my location"}
      </button>
      {status && <p className="text-sm">{status}</p>}
    </main>
  );
}
