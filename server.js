const express = require("express");
const app = express();
app.use(express.json());

// Mount the accessible help system (/help and friends). See help.js.
app.use(require("./help"));

// Forge's read-only Railway ops routes. See railway.js.
app.use(require("./railway"));

// Forge's GitHub commit/read routes. See github.js.
app.use(require("./github"));

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
// Inworld's emotional steering reads surrounding context, so chunks should
// stay reasonably long (a few sentences together = better emotional
// continuity) while still (a) splitting at real natural breaks instead of
// mid-thought, and (b) staying short enough per chunk that Inworld's own
// synthesis time doesn't dominate total latency.
//
// Strategy: split on paragraph breaks first (the most natural place to cut
// without losing emotional context within a thought). Only if a paragraph
// itself is too long do we fall back to grouping whole sentences together
// up to the size limit -- we never split mid-sentence.
//
// MAX_CHUNK_LEN was raised to 1600 on June 27 2026 to fix a different problem
// (sentences getting cut mid-thought) -- but the actual cause of THAT was a
// separate splitSentences() bug (abbreviations/ellipses treated as sentence
// ends), fixed independently on June 28. With that real fix in place, 1600
// no longer buys anything but slow single Inworld calls: chunks ARE
// synthesized in parallel (see Promise.all below), but Inworld's own
// per-request latency scales with text length, so one huge ~1600-char chunk
// can itself take 60-90+ seconds and become the slowest link, which is
// exactly the "now it takes 2 minutes" complaint. Lowered back down to 500
// so a normal multi-sentence reply splits into several smaller, faster,
// genuinely-parallel Inworld calls instead of one slow one -- the GAP_MS
// silence between chunks (below) is what keeps the seams sounding natural,
// not the chunk size itself.
const MAX_CHUNK_LEN = 500;

function splitParagraphs(text) {
  const paras = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  return paras.length ? paras : [text];
}

// Periods after these don't end a sentence (case-insensitive on first letter,
// since "dr." and "Dr." both show up). Periods inside "..." don't either --
// that's a pause for inflection, not a sentence break. Splitting on these was
// handing the TTS model disconnected fragments mid-thought (e.g. "Dr." / "
// Smith said..." as two separate "sentences"), which is what was causing the
// weird, context-less delivery/inflection reported live June 28, 2026.
const SENTENCE_ABBREVIATIONS = [
  "Mr", "Mrs", "Ms", "Dr", "Prof", "Sr", "Jr", "St", "Mt", "vs", "etc",
  "approx", "Inc", "Ltd", "Co", "Corp", "Ave", "Blvd", "No", "e.g", "i.e",
  "a.m", "p.m", "U.S", "U.K", "U.N",
];
const ELLIPSIS_TOKEN = "\u0000ELLIPSIS\u0000";
const DOT_TOKEN = "\u0000DOT\u0000";

function splitSentences(text) {
  if (!text) return [text];

  // Mask ellipses and abbreviation-periods so the sentence-boundary regex
  // below can't mistake them for a sentence end.
  let masked = text.replace(/\.\.\.+/g, ELLIPSIS_TOKEN);
  for (const abbr of SENTENCE_ABBREVIATIONS) {
    const escaped = abbr.replace(/\./g, "\\.");
    masked = masked.replace(new RegExp(`\\b${escaped}\\.(?=\\s)`, "gi"), (m) =>
      m.split(".").join(DOT_TOKEN)
    );
  }

  const matches = masked.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  const restore = (s) =>
    s.split(ELLIPSIS_TOKEN).join("...").split(DOT_TOKEN).join(".");

  if (!matches) return [restore(masked).trim()].filter(Boolean);
  return matches.map((s) => restore(s).trim()).filter(Boolean);
}

// Groups whole sentences together up to maxChunkLen -- used as a fallback
// when a single paragraph is too long to send as one chunk.
function groupSentences(text, maxChunkLen) {
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
  return chunks;
}

function chunkText(text, maxChunkLen = MAX_CHUNK_LEN) {
  const paragraphs = splitParagraphs(text);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if (para.length > maxChunkLen) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...groupSentences(para, maxChunkLen));
      continue;
    }

    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChunkLen && current) {
      chunks.push(current);
      current = para;
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
const GAP_MS = 350;

function buildSilence(ms, { sampleRate, numChannels, bitsPerSample }) {
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.round((sampleRate * ms) / 1000);
  return Buffer.alloc(samples * numChannels * bytesPerSample, 0);
}

// Inworld enforces a hard account-wide cap of 10 concurrent TTS requests
// ("maximum allowed number of concurrent TTS requests: 10 is reached", a 429
// with code 8). Confirmed live June 28, 2026: a single ~7,200-char reply,
// once MAX_CHUNK_LEN dropped to 500 (see above), splits into ~15 chunks --
// all fired at once via Promise.all -- which blows straight through that
// ceiling. Any chunk that gets the 429 throws, Promise.all rejects, and the
// ENTIRE reply's audio dies with a 500, even though most chunks succeeded.
// This is the root cause of the "hanging and generating nothing" / TTS 500
// reports right after the chunk-size change shipped.
//
// Fix has two parts:
//  1. A small in-process semaphore caps how many synthesizeChunk calls are
//     in flight at once, well under Inworld's limit of 10 -- leaving
//     headroom for other concurrent requests elsewhere on the account (other
//     users, the /voices preview page, etc.) instead of assuming this one
//     request owns the whole budget.
//  2. A short retry-with-backoff on the 429 specifically, so even if we do
//     transiently collide with another request's burst, we recover instead
//     of failing the whole reply.
const MAX_CONCURRENT_INWORLD_CALLS = 6;

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  }

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

const inworldLimiter = createLimiter(MAX_CONCURRENT_INWORLD_CALLS);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesizeChunkOnce(text, voiceId, modelId) {
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
    const err = new Error(`Inworld API error ${response.status}: ${errorText}`);
    err.status = response.status;
    err.isRateLimit = response.status === 429;
    throw err;
  }

  const data = await response.json();
  if (!data.audioContent) {
    throw new Error("No audioContent in Inworld response");
  }

  return Buffer.from(data.audioContent, "base64");
}

async function synthesizeChunk(text, voiceId, modelId) {
  return inworldLimiter(async () => {
    const maxAttempts = 4;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await synthesizeChunkOnce(text, voiceId, modelId);
      } catch (err) {
        lastErr = err;
        if (!err.isRateLimit || attempt === maxAttempts) throw err;
        // Backoff with a little jitter so retries from a batch of chunks
        // don't all collide on the same retry tick.
        await sleep(300 * attempt + Math.random() * 200);
      }
    }
    throw lastErr;
  });
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "inworld-tts-proxy" });
});

// Remove web-search citation markers so TTS never voices them. Catches the
// private-use citation chars (U+E200-U+E20F) plus the "turn<N>search<M>"-style
// tokens they carry (also turn<N>news<M>, view, etc. via the generic shape).
// Strips the ":::thinking\n...\n:::\n" reasoning-bubble marker block that
// reframe-proxy now embeds in message.content (added June 28, 2026, so
// LibreChat's legacy content renderer actually shows a "thinking" bubble for
// this custom endpoint). LibreChat's own UI already hides this from the
// visible answer text via the same marker, but the TTS feature is handed the
// raw saved message text, so it needs the same treatment here -- otherwise
// the model's internal reasoning would get read aloud right along with the
// real answer, defeating the whole point of having a separate bubble.
function stripThinkingBlock(text) {
  if (!text) return text;
  return text.replace(/:::thinking[\s\S]*?:::\n?/g, "").trim();
}

function stripCitationMarkers(text) {
  if (!text) return text;
  return text
    // Real OpenAI-style private-use-area citation tokens (actual unicode char
    // U+E200-U+E20F immediately followed by a "turn0search0"-shaped id).
    .replace(/[\uE200-\uE20F]turn\d+[a-z]+\d+/gi, "")
    .replace(/[\uE200-\uE20F]/g, "")
    // What the model in this project (via OpenRouter, web_search/Tavily tool)
    // ACTUALLY emits: the literal escaped text "\ue202turn0search7" as plain
    // characters (backslash, u, e, 2, 0, 2, t, u, r, n, ...) rather than a real
    // private-use codepoint. Confirmed live June 28, 2026 by inspecting a saved
    // message's content array directly. There is no word boundary between the
    // trailing hex digit and "turn", so the old \b-anchored fallback below
    // never matched this -- which is exactly why TTS was reading it aloud as
    // "uturn search...". Strip the escaped-prefix form first, with or without
    // the leading backslash (covers any pre-processing that already ate it).
    .replace(/\\?u[eE]20[0-9a-fA-F]turn\d+[a-zA-Z]+\d+/g, "")
    .replace(/\\?u[eE]20[0-9a-fA-F]/g, "")
    // Catch-all: bare "turn0search0"-shaped token anywhere, even back-to-back
    // with no separating whitespace (no \b requirement -- that was the bug).
    .replace(/turn\d+[a-zA-Z]+\d+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

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

  // Strip web-search citation markers before speaking. The search-augmented
  // model embeds inline citation tokens (a private-use char U+E200-U+E20F
  // followed by a "turn0search3"-style id) into its answer; these render as
  // source chips in the UI but TTS otherwise reads them aloud as gibberish
  // mid-sentence. Visible message text is untouched (this only cleans audio).
  const speakText = stripCitationMarkers(stripThinkingBlock(input));

  try {
    const chunks = chunkText(speakText);

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


// ---- Accessible on-demand voice preview library ----
// Served at GET /voices . The page calls this same service's /v1/audio/speech
// (same origin, so no CORS needed) to generate a short sample per voice on demand.
// NOTE: VOICE_LIST mirrors the `voices:` list in kademurdock/librechat.yaml (what
// users can pick in the UI). If that list changes, update this array too.
const VOICE_LIST = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "Abby", "Alaric", "Alex", "Ashley", "Avery", "Banjo", "Beatrice", "Bianca", "Blake", "Brandon", "Brian", "Brick", "Callum", "Carter", "Cedric", "Celeste", "Chip", "Chloe", "Claire", "Clive", "Conrad", "Cooper", "Cordelia", "Craig", "Damon", "Darlene", "Deborah", "Dennis", "Derek", "Dominus", "Duncan", "Edward", "Eldrin", "Eleanor", "Elizabeth", "Elliot", "Ethan", "Evan", "Evelyn", "Felix", "Freddie", "Gareth", "Graham", "Grant", "Hades", "Hamish", "Hank", "Indi", "Jake", "James", "Jarrah", "Jason", "Jessica", "Jonah", "Joy", "Julia", "Kayla", "Kelsey", "Lauren", "Levi", "Liam", "Loretta", "Lucian", "Luna", "Malcolm", "Marcus", "Mark", "Marlene", "Matilda", "Mia", "Miranda", "Morgana", "Mortimer", "Naomi", "Nate", "Oliver", "Olivia", "Pippa", "Pixie", "Reed", "Riley", "Ronald", "Rosalind", "Rupert", "Sarah", "Sebastian", "Selene", "Serena", "Serene", "Shaun", "Simon", "Snik", "Sophie", "Tahlia", "Tessa", "Theodore", "Timothy", "Trevor", "Tristan", "Tyler", "Veronica", "Victor", "Victoria", "Vinny", "Wendy", "Winifred", "Zadie", "Amy", "Vintage Announcer", "Boss", "Biker Radio", "Young Reader", "Podcaster 1", "Podcaster 2", "Deadpan Narrator", "Carolyn", "Kid Reporter", "Christa", "Colby", "Comedian", "Conversational (Female)", "Crying (Female)", "Cutie (Child)", "Death Metal", "DJ Velvet", "Ducky", "Fara", "R&B DJ (Female) 1", "Nanny Franny", "Fucia", "Gracie (Child)", "Hannah", "Honey", "Houston Stone", "Jerrimiah", "Junior (Child)", "Kade (Kid)", "Kiana (Comedian)", "Lannie", "Southern Local (Male) 1", "Southern Local (Male) 2", "Interview Tape (Male)", "Mazy (Podcaster)", "Megan (Teen)", "Misty", "Nervous Driver (Female)", "Elder Speech (Male)", "Preacher", "Kids' Show Host (Female)", "Queasy Reporter", "Quiet (Male)", "Reanne", "Strict Teacher (Retro)", "R&B DJ (Female) 2", "Ronda (Child)", "Sadie", "Sagey (Child)", "Scarla (Commercial Narrator)", "Scary Narrator (Female)", "Stephen (Shocked)", "Shy & Friendly (Child)", "Southern (Male) 4", "Southern Guy", "Used Car Salesman (Southern)", "Stiff Narrator (Male)", "Sweet Southern Senior", "Antique Tape (Female)", "Tasha Wexler (Reporter) 1", "Tasha Wexler (Reporter) 2", "Teen Reporter (Female)", "Tiffany Tinseltown (Intern)", "Tomboy", "Trevor (Kid)", "Zadia", "Zadiana", "Aditya", "Amara", "Amina", "Andoy", "Anjali", "Arjun", "Boonleng", "Chioma", "Dalisay", "Dhruv", "Emeka", "Emil", "Folake", "Hana", "Huiling", "Ishaan", "Junhao", "Kabir", "Kenji", "Liwa", "Maricel", "Nadia", "Nikhil", "Priya", "Ren", "Saanvi", "Shu", "Tala", "Tunde", "Vikram", "Wei", "Yash", "Zherong", "Birta", "Sharma"];
const SAMPLE_TEXT = "Hi there \u2014 thanks for stopping to listen. Here's a little of what I can do. I can keep things calm and clear, like I'm reading you a story at the end of a long day. I can lift it right up when there's good news, because honestly, that's exciting! And when something really matters, I can slow down and get serious, so you know I mean every word. So... what do you think? If you're looking for a voice to ride along with you, maybe pick me. I'd love the part.";
const VOICE_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kade-AI Voice Library</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background:#0f1115; color:#eceef2; line-height:1.5; }
  a.back { display:inline-block; color:#6ea8fe; text-decoration:none; font-weight:600; margin:0 0 10px; font-size:0.95rem; }
  a.back:focus-visible { outline:3px solid #6ea8fe; outline-offset:2px; }
  header { padding:20px 16px 8px; border-bottom:1px solid #262a33; position:sticky; top:0;
           background:#0f1115; z-index:5; }
  h1 { margin:0 0 6px; font-size:1.5rem; }
  p.intro { margin:0 0 12px; color:#aab2c0; font-size:0.98rem; max-width:60ch; }
  .controls { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  label { font-weight:600; }
  input[type=search]{ flex:1 1 220px; min-width:180px; padding:12px 14px; font-size:1rem;
         border-radius:10px; border:1px solid #3a4150; background:#1a1e26; color:#eceef2; }
  input[type=search]:focus, button:focus-visible { outline:3px solid #6ea8fe; outline-offset:2px; }
  .count { color:#aab2c0; font-size:0.9rem; white-space:nowrap; }
  #status { padding:10px 16px; font-weight:600; min-height:1.4em; color:#9ed3a0;
            background:#141821; border-bottom:1px solid #262a33; position:sticky; top:0; }
  main { padding:12px 16px 40px; }
  ul { list-style:none; margin:0; padding:0; display:grid;
       grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:10px; }
  li { margin:0; }
  button.voice { width:100%; text-align:left; padding:14px 14px; font-size:1rem;
       border-radius:12px; border:1px solid #3a4150; background:#1a1e26; color:#eceef2;
       cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:8px; }
  button.voice:hover { background:#222732; }
  button.voice[aria-pressed=true] { border-color:#6ea8fe; background:#1d2740; }
  .name { font-weight:600; }
  .badge { font-size:0.72rem; padding:2px 8px; border-radius:999px; background:#2a3550;
           color:#bcd2ff; white-space:nowrap; }
  .playing-dot { font-size:0.85rem; color:#6ea8fe; }
  .hint { color:#808992; }
  section.howto { margin:14px 16px 0; padding:14px 16px; background:#141821;
       border:1px solid #2a3550; border-left:4px solid #6ea8fe; border-radius:10px; }
  section.howto h2 { margin:0 0 6px; font-size:1.05rem; }
  section.howto p { margin:6px 0; color:#c4ccd8; font-size:0.95rem; }
  section.howto strong { color:#eceef2; }
  footer { padding:16px; color:#6b7280; font-size:0.85rem; border-top:1px solid #262a33; }
</style>
</head>
<body>
<header>
  <a class="back" href="https://kademurdock.com">← Back to Kade-AI chat</a>
  <h1>Kade-AI Voice Library</h1>
  <p class="intro">Browse every voice available on kademurdock.com. Select any voice to hear a short audition of how it sounds \u2014 a little emotional range, not just a flat read. Samples are generated fresh when you select them, so the first play takes a second or two.</p>
  <div class="controls">
    <label for="search">Search voices</label>
    <input type="search" id="search" placeholder="Type to filter, e.g. southern, child, DJ" autocomplete="off" aria-describedby="count">
    <span class="count" id="count"></span>
  </div>
</header>
<section class="howto" aria-label="How to change your voice">
  <h2>How to use a voice you like</h2>
  <p>Heads up: the chat itself doesn't give us a way to preview voices inside it — which is lame, and it's the whole reason this page exists. Browse here, find one you like, then set it in the app.</p>
  <p>To switch your voice: open <strong>Settings</strong> in the chat, go to the <strong>Speech</strong> tab, find the <strong>Text-to-Speech</strong> section, and choose your voice from the <strong>Voice</strong> menu. The names there match the names here exactly.</p>
</section>
<div id="status" role="status" aria-live="polite">Ready. Select a voice to hear a sample.</div>
<main>
  <ul id="list" aria-label="Available voices"></ul>
</main>
<footer>Powered by Inworld TTS. Each sample is a short audition so you can hear the voice's range. If a voice ever fails to play, it may have been removed on Inworld.</footer>

<script>
  var VOICES = /*VOICES*/;
  var CUSTOM = new Set(/*CUSTOM*/);
  var SAMPLE = /*SAMPLE*/;

  var listEl = document.getElementById("list");
  var statusEl = document.getElementById("status");
  var countEl = document.getElementById("count");
  var searchEl = document.getElementById("search");

  var audio = new Audio();
  var currentBtn = null;
  var currentUrl = null;
  var controller = null;

  function setStatus(msg, color){
    statusEl.textContent = msg;
    statusEl.style.color = color || "#9ed3a0";
  }

  function clearPressed(){
    if (currentBtn){ currentBtn.setAttribute("aria-pressed","false");
      var d = currentBtn.querySelector(".playing-dot"); if(d) d.remove(); currentBtn=null; }
  }

  audio.addEventListener("ended", function(){
    setStatus("Finished. Select another voice to compare.");
    clearPressed();
  });
  audio.addEventListener("playing", function(){
    if (currentBtn){ var nm = currentBtn.getAttribute("data-name");
      setStatus("Now playing: " + nm, "#6ea8fe"); }
  });

  function preview(name, btn){
    if (controller) controller.abort();
    controller = new AbortController();
    audio.pause();
    clearPressed();
    currentBtn = btn;
    btn.setAttribute("aria-pressed","true");
    var dot = document.createElement("span");
    dot.className = "playing-dot"; dot.textContent = "loading";
    dot.setAttribute("aria-hidden","true");
    btn.appendChild(dot);
    setStatus("Generating sample for " + name + ", one moment...", "#e8c46a");

    fetch("/v1/audio/speech", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ input: SAMPLE, voice: name, model: "tts-1" }),
      signal: controller.signal
    }).then(function(r){
      if(!r.ok) throw new Error("server returned " + r.status);
      return r.blob();
    }).then(function(blob){
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(blob);
      audio.src = currentUrl;
      return audio.play();
    }).catch(function(err){
      if (err.name === "AbortError") return;
      setStatus("Could not play " + name + ". " + err.message, "#ff8a8a");
      clearPressed();
    });
  }

  function render(filter){
    filter = (filter||"").trim().toLowerCase();
    listEl.innerHTML = "";
    var shown = 0;
    VOICES.forEach(function(name){
      if (filter && name.toLowerCase().indexOf(filter) === -1) return;
      shown++;
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.className = "voice";
      btn.type = "button";
      btn.setAttribute("data-name", name);
      btn.setAttribute("aria-pressed","false");
      var isCustom = CUSTOM.has(name);
      btn.setAttribute("aria-label", "Play sample of " + name + (isCustom ? ", custom designed voice" : ""));
      var nameSpan = document.createElement("span");
      nameSpan.className = "name"; nameSpan.textContent = name;
      btn.appendChild(nameSpan);
      if (isCustom){ var b=document.createElement("span"); b.className="badge";
        b.textContent="custom"; b.setAttribute("aria-hidden","true"); btn.appendChild(b); }
      btn.addEventListener("click", function(){ preview(name, btn); });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
    countEl.textContent = shown + " of " + VOICES.length + " voices";
  }

  searchEl.addEventListener("input", function(){ render(searchEl.value); });
  render("");
</script>
</body>
</html>`;

app.get(["/voices", "/voice-library"], (req, res) => {
  const custom = Object.keys(CUSTOM_VOICE_MAP);
  // (b) Float Kade's custom-made voices to the top, keeping the existing
  //     English-first order for the rest. (c) Drop the OpenAI-style alias names
  //     (alloy/echo/fable/onyx/nova/shimmer) from the PUBLIC list so nobody
  //     mistakes them for OpenAI's real voices -- their true Inworld voices
  //     (Sarah/Timothy/Edward/Dennis/Julia/Olivia) are already listed by name.
  //     OPENAI_ALIAS_MAP stays intact so LibreChat's internal calls still resolve.
  const customSet = new Set(custom);
  const aliasSet = new Set(Object.keys(OPENAI_ALIAS_MAP));
  const displayList = [
    ...VOICE_LIST.filter((v) => customSet.has(v)),
    ...VOICE_LIST.filter((v) => !customSet.has(v) && !aliasSet.has(v)),
  ];
  const html = VOICE_PAGE_HTML
    .replace("/*VOICES*/", JSON.stringify(displayList))
    .replace("/*CUSTOM*/", JSON.stringify(custom))
    .replace("/*SAMPLE*/", JSON.stringify(SAMPLE_TEXT));
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Inworld TTS proxy running on port ${PORT}`);
});
