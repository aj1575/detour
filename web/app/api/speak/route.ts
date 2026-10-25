const VOICE_ID = "a0e99841-438c-4a64-b679-ae501e7d6091";

export async function POST(request: Request) {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) {
    return Response.json({ error: "CARTESIA_API_KEY is missing." }, { status: 500 });
  }

  let transcript = "";
  try {
    const body = (await request.json()) as { text?: string };
    transcript = body.text?.trim().slice(0, 600) ?? "";
  } catch {
    transcript = "";
  }
  if (!transcript) {
    return Response.json({ error: "Nothing to read aloud." }, { status: 400 });
  }

  const attempts = [
    {
      version: "2025-04-16",
      payload: {
        model_id: "sonic-2",
        transcript,
        voice: { mode: "id", id: VOICE_ID },
        output_format: {
          container: "wav",
          encoding: "pcm_f32le",
          sample_rate: 44100,
        },
      },
    },
    {
      version: "2026-03-01",
      payload: {
        model_id: "sonic-3",
        transcript,
        voice: { mode: "id", id: VOICE_ID },
        output_format: {
          container: "wav",
          encoding: "pcm_s16le",
          sample_rate: 44100,
        },
      },
    },
  ];

  let lastError = "Cartesia did not return audio.";
  for (const attempt of attempts) {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "cartesia-version": attempt.version,
        "content-type": "application/json",
      },
      body: JSON.stringify(attempt.payload),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      const audio = await response.arrayBuffer();
      return new Response(audio, {
        headers: { "content-type": "audio/wav", "cache-control": "no-store" },
      });
    }
    lastError = (await response.text()).replace(/\s+/g, " ").slice(0, 280);
    if (response.status === 401 || response.status === 403) {
      return Response.json(
        { error: "Cartesia rejected the key. Check the key from docs.cartesia.ai/calhacks." },
        { status: 401 },
      );
    }
  }

  return Response.json({ error: lastError }, { status: 502 });
}
