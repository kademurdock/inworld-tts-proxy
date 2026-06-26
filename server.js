const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const INWORLD_API_KEY = process.env.INWORLD_API_KEY;

const OPENAI_ALIAS_MAP = {
  alloy: "Sarah",
  echo: "Timothy",
  fable: "Edward",
  onyx: "Dennis",
  nova: "Julia",
  shimmer: "Olivia",
};

const CUSTOM_VOICE_MAP = {
  "Amy": "default-e-m11vgtr9l-m7afw4kmnw__amy",
  "Vintage Announcer": "default-e-m11vgtr9l-m7afw4kmnw__antique_guy",
  "Boss": "default-e-m11vgtr9l-m7afw4kmnw__bawse",
  "Biker Radio": "default-e-m11vgtr9l-m7afw4kmnw__biker_station_voice",
  "Birta": "default-e-m11vgtr9l-m7afw4kmnw__birta",
  "Young Reader": "default-e-m11vgtr9l-m7afw4kmnw__black_child_reading",
  "Podcaster 1": "default-e-m11vgtr9l-m7afw4kmnw__black_female_podcaster1",
  "Podcaster 2": "default-e-m11vgtr9l-m7afw4kmnw__black_female_podcaster2",
  "Deadpan Narrator": "default-e-m11vgtr9l-m7afw4kmnw__boring_guy_recording",
  "Carolyn": "default-e-m11vgtr9l-m7afw4kmnw__carolyn",
  "Kid Reporter": "default-e-m11vgtr9l-m7afw4kmnw__child_reporter",
  "Christa": "default-e-m11vgtr9l-m7afw4kmnw__christa",
  "Colby": "default-e-m11vgtr9l-m7afw4kmnw__colby",
  "Comedian": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-7d768c00",
  "Conversational (Female)": "default-e-m11vgtr9l-m7afw4kmnw__conversia_girl",
  "Crying (Female)": "default-e-m11vgtr9l-m7afw4kmnw__crying_woman1",
  "Cutie (Child)": "default-e-m11vgtr9l-m7afw4kmnw__cutie_child",
  "Death Metal": "default-e-m11vgtr9l-m7afw4kmnw__death_metal_devil",
  "DJ Velvet": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-490b0c53",
  "Ducky": "default-e-m11vgtr9l-m7afw4kmnw__ducky_quackster",
  "Fara": "default-e-m11vgtr9l-m7afw4kmnw__fara",
  "R&B DJ (Female) 1": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-4c9f3a1e",
  "Nanny Franny": "default-e-m11vgtr9l-m7afw4kmnw__franny_the_nanny",
  "Fucia": "default-e-m11vgtr9l-m7afw4kmnw__fucia_black_young_adult_or_teen",
  "Gracie (Child)": "default-e-m11vgtr9l-m7afw4kmnw__gracie_child",
  "Hannah": "default-e-m11vgtr9l-m7afw4kmnw__hannah",
  "Honey": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-770cd001",
  "Houston Stone": "default-e-m11vgtr9l-m7afw4kmnw__houston_stone",
  "Jerrimiah": "default-e-m11vgtr9l-m7afw4kmnw__jerrimiah",
  "Junior (Child)": "default-e-m11vgtr9l-m7afw4kmnw__junior_cute_child",
  "Kade (Kid)": "default-e-m11vgtr9l-m7afw4kmnw__kade_ten_years_old",
  "Kiana (Comedian)": "default-e-m11vgtr9l-m7afw4kmnw__kiana_the_commedian",
  "Lannie": "default-e-m11vgtr9l-m7afw4kmnw__lannie",
  "Southern Local (Male) 1": "default-e-m11vgtr9l-m7afw4kmnw__local_southern_man1",
  "Southern Local (Male) 2": "default-e-m11vgtr9l-m7afw4kmnw__local_southern_man_2",
  "Interview Tape (Male)": "default-e-m11vgtr9l-m7afw4kmnw__male_doing_taped_interview",
  "Mazy (Podcaster)": "default-e-m11vgtr9l-m7afw4kmnw__mazy_podcaster_female",
  "Megan (Teen)": "default-e-m11vgtr9l-m7afw4kmnw__megan_female_teen",
  "Misty": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-d0d9f95c",
  "Nervous Driver (Female)": "default-e-m11vgtr9l-m7afw4kmnw__nervous_female_driver",
  "Elder Speech (Male)": "default-e-m11vgtr9l-m7afw4kmnw__old_guy_speech",
  "Preacher": "default-e-m11vgtr9l-m7afw4kmnw__preacher",
  "Kids' Show Host (Female)": "default-e-m11vgtr9l-m7afw4kmnw__preschool_show_host_female",
  "Queasy Reporter": "default-e-m11vgtr9l-m7afw4kmnw__pukin_reporter",
  "Quiet (Male)": "default-e-m11vgtr9l-m7afw4kmnw__quiet_guy",
  "Reanne": "default-e-m11vgtr9l-m7afw4kmnw__reanne",
  "Strict Teacher (Retro)": "default-e-m11vgtr9l-m7afw4kmnw__retro_strict_teacher_female",
  "R&B DJ (Female) 2": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-3ef0834f",
  "Ronda (Child)": "default-e-m11vgtr9l-m7afw4kmnw__ronda_snotty_sounding_child",
  "Sadie": "default-e-m11vgtr9l-m7afw4kmnw__sadie",
  "Sagey (Child)": "default-e-m11vgtr9l-m7afw4kmnw__sagey_child",
  "Scarla (Commercial Narrator)": "default-e-m11vgtr9l-m7afw4kmnw__scarla_female_child_commercial_narrator",
  "Scary Narrator (Female)": "default-e-m11vgtr9l-m7afw4kmnw__scary_female_narrator",
  "Sharma": "default-e-m11vgtr9l-m7afw4kmnw__sharma",
  "Stephen (Shocked)": "default-e-m11vgtr9l-m7afw4kmnw__shocked_stephen",
  "Shy & Friendly (Child)": "default-e-m11vgtr9l-m7afw4kmnw__shy_friendly_child",
  "Southern (Male) 4": "default-e-m11vgtr9l-m7afw4kmnw__southern_man_4_with_speech_delay",
  "Southern Guy": "default-e-m11vgtr9l-m7afw4kmnw__southern_stranger_danger_dude",
  "Used Car Salesman (Southern)": "default-e-m11vgtr9l-m7afw4kmnw__southern_used_car_guy",
  "Stiff Narrator (Male)": "default-e-m11vgtr9l-m7afw4kmnw__stiff_narrator_male",
  "Sweet Southern Senior": "default-e-m11vgtr9l-m7afw4kmnw__super_southern_senior_sweety",
  "Antique Tape (Female)": "default-e-m11vgtr9l-m7afw4kmnw__taped_antique_female",
  "Tasha Wexler (Reporter) 1": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-d8af8cf0",
  "Tasha Wexler (Reporter) 2": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-0df70f81",
  "Teen Reporter (Female)": "default-e-m11vgtr9l-m7afw4kmnw__teen_reporter_female",
  "Tiffany Tinseltown (Intern)": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-ce8aef66",
  "Tomboy": "default-e-m11vgtr9l-m7afw4kmnw__tom_girl",
  "Trevor (Kid)": "default-e-m11vgtr9l-m7afw4kmnw__trevor_male_kid",
  "Zadia": "default-e-m11vgtr9l-m7afw4kmnw__zadia",
  "Zadiana": "default-e-m11vgtr9l-m7afw4kmnw__zadiana",
};

const VOICE_MAP = { ...OPENAI_ALIAS_MAP, ...CUSTOM_VOICE_MAP };

const MODEL_MAP = {
  "tts-1": "inworld-tts-1.5-max",
  "tts-1-hd": "inworld-tts-1.5-max",
  "gpt-4o-mini-tts": "inworld-tts-1.5-max",
};

// ---- Chunking ----
// Splits text into sentence-grouped chunks so we can fire several smaller
// requests at Inworld IN PARALLEL instead of waiting on one giant serial
// request. Never splits mid-sentence unless a single sentence itself is
// longer than maxChunkLen.
const MAX_CHUNK_LEN = 350;

function splitSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map((s) => s.trim()).filter(Boolean);
}

function chunkText(text, maxChunkLen = MAX_CHUNK_LEN) {
  const sentences = splitSentences(text);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChunkLen) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChunkLen) {
        chunks.push(sentence.slice(i, i + maxChunkLen));
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChunkLen && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

// ---- WAV helpers ----
// Inworld returns base64 WAV (16-bit PCM). We parse out the raw PCM samples
// from each chunk's WAV, splice in a short silence gap between chunks so
// sentence boundaries actually sound like sentence boundaries, then wrap
// the combined PCM back into a single WAV file to send to LibreChat.

function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset < buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        numChannels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      data = buffer.slice(chunkStart, chunkStart + chunkSize);
    }

    offset = chunkStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (!fmt || !data) throw new Error("Malformed WAV (missing fmt or data chunk)");
  return { ...fmt, data };
}

function buildWavHeader(dataLength, { numChannels, sampleRate, bitsPerSample }) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataLength, 40);

  return header;
}

// ~140ms of silence between chunks -- long enough to sound like a natural
// pause, short enough not to feel like dead air.
const GAP_MS = 140;

function buildSilence(ms, { sampleRate, numChannels, bitsPerSample }) {
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.round((sampleRate * ms) / 1000);
  return Buffer.alloc(samples * numChannels * bytesPerSample, 0);
}

async function synthesizeChunk(text, voiceId, modelId) {
  const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
    method: "POST",
    headers: {
      Authorization: `Basic ${INWORLD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voiceId,
      modelId,
      audioConfig: {
        audioEncoding: "WAV",
        sampleRateHertz: 24000,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Inworld API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (!data.audioContent) {
    throw new Error("No audioContent in Inworld response");
  }

  return Buffer.from(data.audioContent, "base64");
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "inworld-tts-proxy" });
});

// This is the endpoint LibreChat will hit -- it expects OpenAI's /v1/audio/speech path
app.post("/v1/audio/speech", async (req, res) => {
  if (!INWORLD_API_KEY) {
    return res.status(500).json({ error: "INWORLD_API_KEY not set" });
  }

  const { input, voice = "alloy", model = "tts-1" } = req.body;

  if (!input) {
    return res.status(400).json({ error: "Missing required field: input" });
  }

  const inworldVoice = VOICE_MAP[voice] || voice;
  const inworldModel = MODEL_MAP[model] || "inworld-tts-1.5-max";

  try {
    const chunks = chunkText(input);

    // Fire every chunk at Inworld in parallel instead of waiting on one
    // giant request -- this is the actual latency fix.
    const wavBuffers = await Promise.all(
      chunks.map((chunk) => synthesizeChunk(chunk, inworldVoice, inworldModel))
    );

    const parsed = wavBuffers.map(parseWav);
    const format = {
      numChannels: parsed[0].numChannels,
      sampleRate: parsed[0].sampleRate,
      bitsPerSample: parsed[0].bitsPerSample,
    };

    const silence = chunks.length > 1 ? buildSilence(GAP_MS, format) : Buffer.alloc(0);

    const pieces = [];
    parsed.forEach((p, i) => {
      pieces.push(p.data);
      if (i < parsed.length - 1) pieces.push(silence);
    });

    const combinedData = Buffer.concat(pieces);
    const header = buildWavHeader(combinedData.length, format);
    const finalAudio = Buffer.concat([header, combinedData]);

    res.set("Content-Type", "audio/wav");
    res.set("Content-Length", finalAudio.length);
    res.send(finalAudio);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy internal error", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Inworld TTS proxy running on port ${PORT}`);
});
