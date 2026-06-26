const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const INWORLD_API_KEY = process.env.INWORLD_API_KEY;

// Maps OpenAI voice names to Inworld voice IDs.
// You can edit these — run GET https://api.inworld.ai/voices/v1/voices to see all available.
const VOICE_MAP = {
  alloy: "Sarah",
  echo: "Timothy",
  fable: "Edward",
  onyx: "Dennis",
  nova: "Julia",
  shimmer: "Olivia",
};

// Maps OpenAI model names to Inworld model IDs
const MODEL_MAP = {
  "tts-1": "inworld-tts-1.5-max",
  "tts-1-hd": "inworld-tts-1.5-max",
  "gpt-4o-mini-tts": "inworld-tts-1.5-max",
};

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "inworld-tts-proxy" });
});

// This is the endpoint LibreChat will hit — it expects OpenAI's /v1/audio/speech path
app.post("/v1/audio/speech", async (req, res) => {
  if (!INWORLD_API_KEY) {
    return res.status(500).json({ error: "INWORLD_API_KEY not set" });
  }

  const { input, voice = "alloy", model = "tts-1", response_format = "mp3" } = req.body;

  if (!input) {
    return res.status(400).json({ error: "Missing required field: input" });
  }

  const inworldVoice = VOICE_MAP[voice] || voice; // fall through if they pass an Inworld voice ID directly
  const inworldModel = MODEL_MAP[model] || "inworld-tts-1.5-max";

  // Inworld only supports mp3 and wav — default to mp3
  const audioEncoding = response_format === "wav" ? "WAV" : "MP3";

  try {
    const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
      method: "POST",
      headers: {
        Authorization: `Basic ${INWORLD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input,
        voiceId: inworldVoice,
        modelId: inworldModel,
        audioConfig: {
          audioEncoding,
          sampleRateHertz: 24000,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Inworld API error ${response.status}:`, errorText);
      return res.status(response.status).json({
        error: "Inworld API error",
        details: errorText,
      });
    }

    const data = await response.json();

    if (!data.audioContent) {
      console.error("No audioContent in Inworld response:", data);
      return res.status(500).json({ error: "No audio content returned from Inworld" });
    }

    // Decode base64 and send raw audio bytes — exactly what LibreChat expects
    const audioBuffer = Buffer.from(data.audioContent, "base64");
    const contentType = audioEncoding === "WAV" ? "audio/wav" : "audio/mpeg";

    res.set("Content-Type", contentType);
    res.set("Content-Length", audioBuffer.length);
    res.send(audioBuffer);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy internal error", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Inworld TTS proxy running on port ${PORT}`);
});
