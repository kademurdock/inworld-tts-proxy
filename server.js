const express = require("express");
const crypto = require("crypto");
const app = express();
// July 18 2026: raised from the 100kb default so /github/commit can carry
// whole large files (e.g. the bridge's voice-stream.js, ~140KB raw) — the
// commit proxy is whole-file by design, so its body limit must fit the
// biggest file anyone needs to ship through it.
app.use(express.json({ limit: "10mb" })); /* Aug 14 2026: was 2mb — the agent-avatar
 * lane ships base64 PNGs (~2MB image = ~2.7MB JSON) and the GLOBAL parser
 * runs before any route-level limit can raise it (the bridge paid for this
 * same lesson on /app-crashes). TTS bodies are tiny; only avatars are big. */

// Mount the accessible help system (/help and friends). See help.js.
app.use(require("./help"));

// KADE Aug 8 2026: unlisted plain-text mirrors of her MOO design docs at
// /design/:doc so any character can kade_read_page the FULL canon while
// spitballing (her folder stays canon; sessions refresh on change).
app.use(require("./designdocs"));

// Forge's read-only Railway ops routes. See railway.js.
app.use(require("./railway"));

// Forge's GitHub commit/read routes. See github.js.
app.use(require("./github"));

// LibreChat platform-management routes for Forge (agents API, usage)
app.use(require("./librechat"));

const PORT = process.env.PORT || 3000;

// Multi-speaker scenes (Aug 6 2026, ideas 16+52) — pure script/text helpers.
// Audio glue lives beside the /v1/audio/speech handler below.
const { SCENE_TAG_RE, SCENE_TAG_G, parseSceneScript, parseAssignments } = require("./scene-engine");
/* Part 98 (Aug 29 2026) — the streaming playback lane's pure half lives in
 * its own module so it can be tested without a network. See stream-lane.js
 * for the design call (remembered-gain normalization) and the measured
 * numbers (1.9s whole-clip vs 438ms first streamed audio). */
const { createNdjsonAudioParser, sniffWavFormat, buildStreamingWavHeader, createStreamProcessor } = require("./stream-lane");
// Kill switch for the whole streamed lane: KADE_TTS_STREAM=0 makes the proxy
// ignore the stream flag entirely and every caller gets today's buffered WAV.
const TTS_STREAM_ENABLED = process.env.KADE_TTS_STREAM !== "0";
const INWORLD_API_KEY = process.env.INWORLD_API_KEY;

// ── Fish Audio: second TTS provider beside Inworld (July 22 2026, Kade's pick) ──
// Kade's fish.audio clone library rides the SAME numbered-voice plumbing:
// VOICE_MAP targets prefixed "fish:<model_id>" route to fishSynthesizeChunk
// below instead of Inworld; everything downstream (chunking, silence splice,
// loudness EMA, telephony mu-law, /voices.json) is provider-blind.
// Model tier is s2.1-pro by Kade's explicit choice July 22 (the free tier
// s2.1-pro-free ends July 31 2026 AND retains audio for training — wrong fit
// for a family platform; pro ≈ $15/M UTF-8 bytes ≈ a nickel per 10-min call).
// Steering (UPDATED Aug 3 2026): fish gets per-SENTENCE direction re-seeding
// at synth (seedFishSteering) — fish cues are sentence-scoped, one leading tag
// per paragraph left its later sentences flat. Inworld chunks get one-
// direction-per-request shaping (shapeInworldSteering). Original note below:
// fish s2.1 interprets the same [bracket] free-text word-level tags
// applySteeringTags already emits for Inworld TTS-2, so %%% tags translate
// with NO agent-side changes (s1 would need a preset-parentheses menu — do
// not downgrade FISH_TTS_MODEL below s2 without revisiting steering).
const FISH_API_KEY = process.env.FISH_API_KEY;
const FISH_TTS_MODEL = process.env.FISH_TTS_MODEL || "s2.1-pro";
const FISH_TTS_LATENCY = process.env.FISH_TTS_LATENCY || "normal"; // normal|balanced|low
// Fish clones speak at their source sample's natural pace — do NOT inherit
// Inworld's global 1.1 speed-up default; 1.0 keeps Kade's clones sounding
// like the people they were cloned from. Per-request `speed` still wins.
const FISH_TTS_SPEED = parseFloat(process.env.FISH_TTS_SPEED || "1.0");
const FISH_TEMPERATURE = parseFloat(process.env.FISH_TEMPERATURE || "0.9");
const FISH_TOP_P = parseFloat(process.env.FISH_TOP_P || "0.7");
const FISH_VOICE_PREFIX = "fish:";

// Voice performance tuning for inworld-tts-2. Note: this model IGNORES the
// `temperature` field entirely (per Inworld's own API docs -- "Ignored on
// inworld-tts-2. Use deliveryMode instead."), so deliveryMode is the real
// emotional-range knob here, not temperature. speakingRate is separate --
// pure pacing, [0.5, 1.5], 1.0 = the voice's own native speed.
// Both env-overridable so they can be re-tuned without a code change.
const TTS_DELIVERY_MODE = process.env.TTS_DELIVERY_MODE || "CREATIVE";
/* ⭐ AUG 26 2026 — 1.1 -> 1.0, Kade's call ("you can fix the speed on tts thing").
 * 1.1 was never chosen here; it is Inworld's own global default, inherited when
 * this file was written and never questioned. Its neighbour FISH_TTS_SPEED was
 * DELIBERATELY walked back to 1.0 with the note "Inworld's global 1.1 speed-up
 * default; 1.0 keeps Kade's clones sounding like the people they were cloned
 * from" — the same reasoning was simply never applied on this side of the file,
 * so every Inworld voice on the platform has been running 10% fast for months.
 * That is a standing tax on top of any pace word a character writes into a
 * steering tag, which is the bug she reported on Aug 25.
 * 1.0 = the voice's own native speed. Per-request `speed` still wins, and
 * TTS_SPEAKING_RATE on Railway still overrides this — keep them in sync. */
const TTS_SPEAKING_RATE = parseFloat(process.env.TTS_SPEAKING_RATE || "1.0");

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
  // ── 2026-07-12 additions (Kade's new designed voices, clone-vetted) ──
  // ── same-day evening batch (21 more) ──
  "Aussie": "default-e-m11vgtr9l-m7afw4kmnw__aussie",
  "Beasty": "default-e-m11vgtr9l-m7afw4kmnw__beasty",
  "Beddy": "default-e-m11vgtr9l-m7afw4kmnw__beddy",
  "Biscut Female": "default-e-m11vgtr9l-m7afw4kmnw__biscut_female",
  "Gania": "default-e-m11vgtr9l-m7afw4kmnw__gania",
  "Hardware Guy": "default-e-m11vgtr9l-m7afw4kmnw__hardware_guy",
  "Heather": "default-e-m11vgtr9l-m7afw4kmnw__heather",
  "Historic Guy": "default-e-m11vgtr9l-m7afw4kmnw__historic_guy",
  "Infomercial Guy": "default-e-m11vgtr9l-m7afw4kmnw__infomercial_guy",
  "Irish Dude": "default-e-m11vgtr9l-m7afw4kmnw__irish_dude",
  "Jason": "default-e-m11vgtr9l-m7afw4kmnw__jason",
  "Josh": "default-e-m11vgtr9l-m7afw4kmnw__josh",
  "Kylah": "default-e-m11vgtr9l-m7afw4kmnw__kylah",
  "Marla": "default-e-m11vgtr9l-m7afw4kmnw__marla",
  "Nate": "default-e-m11vgtr9l-m7afw4kmnw__nate",
  "Ojo": "default-e-m11vgtr9l-m7afw4kmnw__ojo",
  "Paul": "default-e-m11vgtr9l-m7afw4kmnw__paul",
  "Paulina": "default-e-m11vgtr9l-m7afw4kmnw__paulina",
  "Quiet Man (Another)": "default-e-m11vgtr9l-m7afw4kmnw__another_quiet_man",
  "Southern Guy (Another)": "default-e-m11vgtr9l-m7afw4kmnw__southern_guy_another",
  "Wendi": "default-e-m11vgtr9l-m7afw4kmnw__wendi",
  "Amazed Woman": "default-e-m11vgtr9l-m7afw4kmnw__amazed_woman",
  "Angry Cartoon Dad": "default-e-m11vgtr9l-m7afw4kmnw__angry_cartoon_dad",
  "Anna Teen Female": "default-e-m11vgtr9l-m7afw4kmnw__anna_teen_female",
  "Assia Black Female Casual": "default-e-m11vgtr9l-m7afw4kmnw__assia_black_female_casual",
  "Bar Brit Guy": "default-e-m11vgtr9l-m7afw4kmnw__bar_brit_guy",
  "Bex": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-56c25ad3",
  "Bipolar Animated Emotions Guy": "default-e-m11vgtr9l-m7afw4kmnw__bipolar_animated_emotions_guy",
  "Black Dude 1": "default-e-m11vgtr9l-m7afw4kmnw__black_dude1",
  "Black Dude 2": "default-e-m11vgtr9l-m7afw4kmnw__black_dude2",
  "Black Male Podcaster 1": "default-e-m11vgtr9l-m7afw4kmnw__black_male_podcaster",
  "Black Male Podcaster 2": "default-e-m11vgtr9l-m7afw4kmnw__black_male_podcaster2",
  "Black Male Podcaster 3": "default-e-m11vgtr9l-m7afw4kmnw__black_male_podcaster3",
  "Casual Black Houston Woman": "default-e-m11vgtr9l-m7afw4kmnw__casual_black_houston_woman",
  "Casual Chef": "default-e-m11vgtr9l-m7afw4kmnw__casual_chef",
  "Chef2": "default-e-m11vgtr9l-m7afw4kmnw__chef2",
  "Daisy Black Female": "default-e-m11vgtr9l-m7afw4kmnw__daisy_black_female",
  "Deep Voice Dan": "default-e-m11vgtr9l-m7afw4kmnw__deep_voice_dan",
  "Detective": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-040c5300",
  "DJ For Kid Intersticials Female": "default-e-m11vgtr9l-m7afw4kmnw__dj_for_kid_intersticials_female",
  "Doctor Therapist": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-86be25f6",
  "Dollya": "default-e-m11vgtr9l-m7afw4kmnw__dollya",
  "Emma (Stuffy Smoker)": "default-e-m11vgtr9l-m7afw4kmnw__emma_stuffy_smoker_female",
  "Emotional Male Rapper": "default-e-m11vgtr9l-m7afw4kmnw__emotional_male_rapper",
  "Exotic Guy": "default-e-m11vgtr9l-m7afw4kmnw__exotic_guy",
  "Fabiola": "default-e-m11vgtr9l-m7afw4kmnw__fabiola",
  "Female Host With Strong Accent": "default-e-m11vgtr9l-m7afw4kmnw__female_host_with_strong_accent",
  "Fine Guy 1": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy_1",
  "Fine Guy 2": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy_2",
  "Fine Guy 4": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy4",
  "Fine Guy 5": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy5",
  "Fine Guy 6": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy_6",
  "Freddy Male Casual": "default-e-m11vgtr9l-m7afw4kmnw__freddy_male_casual",
  "Gamer Guy": "default-e-m11vgtr9l-m7afw4kmnw__gamer_guy",
  "Garrott Male": "default-e-m11vgtr9l-m7afw4kmnw__garrott_male",
  "Granny Dianna": "default-e-m11vgtr9l-m7afw4kmnw__granny_dianna",
  "Granny Roothey": "default-e-m11vgtr9l-m7afw4kmnw__granny_roothey",
  "Grump Guy 1": "default-e-m11vgtr9l-m7afw4kmnw__grump_guy_1",
  "Grump Guy 3": "default-e-m11vgtr9l-m7afw4kmnw__grump_guy_3",
  "Grump Guy 3 Alt": "default-e-m11vgtr9l-m7afw4kmnw__grump_guy3",
  "Harly White Male": "default-e-m11vgtr9l-m7afw4kmnw__harly_white_male",
  "Hispanic Dude 1": "default-e-m11vgtr9l-m7afw4kmnw__hispanic_dude1",
  "Hispanic Woman": "default-e-m11vgtr9l-m7afw4kmnw__hispanic_woman",
  "Irish Preacher": "default-e-m11vgtr9l-m7afw4kmnw__irish_preacher",
  "Ivy": "default-e-m11vgtr9l-m7afw4kmnw__ivy",
  "Jamaikan Granny": "default-e-m11vgtr9l-m7afw4kmnw__jamaikan_granny",
  "Jennie": "default-e-m11vgtr9l-m7afw4kmnw__jennie",
  "Jennifer": "default-e-m11vgtr9l-m7afw4kmnw__jennifer",
  "Laurie Black Female": "default-e-m11vgtr9l-m7afw4kmnw__laurie_black_female",
  "Luna": "default-e-m11vgtr9l-m7afw4kmnw__luna",
  "Mac": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-64cbd04a",
  "Male Podcaster": "default-e-m11vgtr9l-m7afw4kmnw__male_podcaster",
  "Martha Faith (Southern)": "default-e-m11vgtr9l-m7afw4kmnw__martha_faith_souther_female",
  "Maxie": "default-e-m11vgtr9l-m7afw4kmnw__maxie",
  "Mean Female": "default-e-m11vgtr9l-m7afw4kmnw__mean_female",
  "Meeka": "default-e-m11vgtr9l-m7afw4kmnw__meeka",
  "Mex Granny": "default-e-m11vgtr9l-m7afw4kmnw__mex_granny",
  "Monica Young Female": "default-e-m11vgtr9l-m7afw4kmnw__monica_young_female",
  "Morgan": "default-e-m11vgtr9l-m7afw4kmnw__morgan",
  "Mya Liyah": "default-e-m11vgtr9l-m7afw4kmnw__mya_liyah",
  "Nanny": "default-e-m11vgtr9l-m7afw4kmnw__nanny",
  "Patunya Black Middle-age Female": "default-e-m11vgtr9l-m7afw4kmnw__patunya_black_middle-age_female",
  "Porker": "default-e-m11vgtr9l-m7afw4kmnw__porker",
  "Poser Dude": "default-e-m11vgtr9l-m7afw4kmnw__poser_dude",
  "Posie Neutral Female": "default-e-m11vgtr9l-m7afw4kmnw__posie_neutral_female",
  "Professor Guy": "default-e-m11vgtr9l-m7afw4kmnw__professor_guy",
  "Professor Guy2": "default-e-m11vgtr9l-m7afw4kmnw__professor_guy2",
  "Ren, Professional Female": "default-e-m11vgtr9l-m7afw4kmnw__ren_professional_female",
  "Russian Storyteller": "default-e-m11vgtr9l-m7afw4kmnw__russian_storyteller",
  // 2026-07-17 additions (Kade's new designed voices; clones still held back):
  "Kaylin (Child)": "default-e-m11vgtr9l-m7afw4kmnw__kaylin_child",
  "Kiki": "default-e-m11vgtr9l-m7afw4kmnw__kiki",
  "Satarah": "default-e-m11vgtr9l-m7afw4kmnw__satarah",
  "Trutia": "default-e-m11vgtr9l-m7afw4kmnw__trutia",
  "Sally May": "default-e-m11vgtr9l-m7afw4kmnw__sally_may",
  "Scary Male PA Announcer": "default-e-m11vgtr9l-m7afw4kmnw__scary_male_pa_announcer",
  "Southern Black Dude 1": "default-e-m11vgtr9l-m7afw4kmnw__southern_black_dude1",
  "Southern Female Preacher 1": "default-e-m11vgtr9l-m7afw4kmnw__southern_female_preacher1",
  "Southern Female Preacher 2": "default-e-m11vgtr9l-m7afw4kmnw__southern_female_preacher2",
  "Southern Preacher 1": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher1",
  "Southern Preacher 2": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher2",
  "Southern Preacher 3": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher3",
  "Southern Preacher 4": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher_4",
  "Southern Preacher Jackle": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher_jackle",
  "Steevie Male Kid Friendly Host": "default-e-m11vgtr9l-m7afw4kmnw__steevie_male_kid_friendly_host",
  "Stereotypical Evil Brit": "default-e-m11vgtr9l-m7afw4kmnw__stereotypical_evil_brit",
  "Surf Dude 1": "default-e-m11vgtr9l-m7afw4kmnw__surf_dude1",
  "Surfin Stoner": "default-e-m11vgtr9l-m7afw4kmnw__surfin_stoner",
  "Susu": "default-e-m11vgtr9l-m7afw4kmnw__susu",
  "Tanya Black Female Southern": "default-e-m11vgtr9l-m7afw4kmnw__tanya_black_female_southern",
  "Tess": "default-e-m11vgtr9l-m7afw4kmnw__tess",
  "Tilly Female": "default-e-m11vgtr9l-m7afw4kmnw__tilly_female",
  "Tina": "default-e-m11vgtr9l-m7afw4kmnw__tina",
  "Toya": "default-e-m11vgtr9l-m7afw4kmnw__toya",
  "Trailer Guy": "default-e-m11vgtr9l-m7afw4kmnw__trailer_guy",
  "Understanding Female": "default-e-m11vgtr9l-m7afw4kmnw__understanding_female",
  "Varonica": "default-e-m11vgtr9l-m7afw4kmnw__varonica",
  "Whispering Female Ghostly Voice": "default-e-m11vgtr9l-m7afw4kmnw__whispering_female_ghostly_voice",
  "Yelling Southern Preacher": "default-e-m11vgtr9l-m7afw4kmnw__yelling_southern_preacher",
};

// LEGACY numbering (June 2026, pre-renumber) -- kept verbatim as the source
// the 2026-07-01 renumbering below derives from. Do NOT hand-edit the derived
// map; edit THIS one (add/remove voices here) and the derivation re-numbers.
const NUMBERED_VOICE_ALIASES_LEGACY_2026_06 = {
  "Voice 1": "Abby",
  "Voice 2": "Alaric",
  "Voice 3": "Alex",
  "Voice 4": "Ashley",
  "Voice 5": "Avery",
  "Voice 6": "Banjo",
  "Voice 7": "Beatrice",
  "Voice 8": "Bianca",
  "Voice 9": "Blake",
  "Voice 10": "Brandon",
  "Voice 11": "Brian",
  "Voice 12": "Brick",
  "Voice 13": "Callum",
  "Voice 14": "Carter",
  "Voice 15": "Cedric",
  "Voice 16": "Celeste",
  "Voice 17": "Chip",
  "Voice 18": "Chloe",
  "Voice 19": "Claire",
  "Voice 20": "Clive",
  "Voice 21": "Conrad",
  "Voice 22": "Cooper",
  "Voice 23": "Cordelia",
  "Voice 24": "Craig",
  "Voice 25": "Damon",
  "Voice 26": "Darlene",
  "Voice 27": "Deborah",
  "Voice 28": "Dennis",
  "Voice 29": "Derek",
  "Voice 30": "Dominus",
  "Voice 31": "Duncan",
  "Voice 32": "Edward",
  "Voice 33": "Eldrin",
  "Voice 34": "Eleanor",
  "Voice 35": "Elizabeth",
  "Voice 36": "Elliot",
  "Voice 37": "Ethan",
  "Voice 38": "Evan",
  "Voice 39": "Evelyn",
  "Voice 40": "Felix",
  "Voice 41": "Freddie",
  "Voice 42": "Gareth",
  "Voice 43": "Graham",
  "Voice 44": "Grant",
  "Voice 45": "Hades",
  "Voice 46": "Hamish",
  "Voice 47": "Hank",
  "Voice 48": "Indi",
  "Voice 49": "Jake",
  "Voice 50": "James",
  "Voice 51": "Jarrah",
  "Voice 52": "Jason",
  "Voice 53": "Jessica",
  "Voice 54": "Jonah",
  "Voice 55": "Joy",
  "Voice 56": "Julia",
  "Voice 57": "Kayla",
  "Voice 58": "Kelsey",
  "Voice 59": "Lauren",
  "Voice 60": "Levi",
  "Voice 61": "Liam",
  "Voice 62": "Loretta",
  "Voice 63": "Lucian",
  "Voice 64": "Luna",
  "Voice 65": "Malcolm",
  "Voice 66": "Marcus",
  "Voice 67": "Mark",
  "Voice 68": "Marlene",
  "Voice 69": "Matilda",
  "Voice 70": "Mia",
  "Voice 71": "Miranda",
  "Voice 72": "Morgana",
  "Voice 73": "Mortimer",
  "Voice 74": "Naomi",
  "Voice 75": "Nate",
  "Voice 76": "Oliver",
  "Voice 77": "Olivia",
  "Voice 78": "Pippa",
  "Voice 79": "Pixie",
  "Voice 80": "Reed",
  "Voice 81": "Riley",
  "Voice 82": "Ronald",
  "Voice 83": "Rosalind",
  "Voice 84": "Rupert",
  "Voice 85": "Sarah",
  "Voice 86": "Sebastian",
  "Voice 87": "Selene",
  "Voice 88": "Serena",
  "Voice 89": "Serene",
  "Voice 90": "Shaun",
  "Voice 91": "Simon",
  "Voice 92": "Snik",
  "Voice 93": "Sophie",
  "Voice 94": "Tahlia",
  "Voice 95": "Tessa",
  "Voice 96": "Theodore",
  "Voice 97": "Timothy",
  "Voice 98": "Trevor",
  "Voice 99": "Tristan",
  "Voice 100": "Tyler",
  "Voice 101": "Veronica",
  "Voice 102": "Victor",
  "Voice 103": "Victoria",
  "Voice 104": "Vinny",
  "Voice 105": "Wendy",
  "Voice 106": "Winifred",
  "Voice 107": "Zadie",
  "Voice 108": "default-e-m11vgtr9l-m7afw4kmnw__amy",
  "Voice 109": "default-e-m11vgtr9l-m7afw4kmnw__antique_guy",
  "Voice 110": "default-e-m11vgtr9l-m7afw4kmnw__bawse",
  "Voice 111": "default-e-m11vgtr9l-m7afw4kmnw__biker_station_voice",
  "Voice 112": "default-e-m11vgtr9l-m7afw4kmnw__black_child_reading",
  "Voice 113": "default-e-m11vgtr9l-m7afw4kmnw__black_female_podcaster1",
  "Voice 114": "default-e-m11vgtr9l-m7afw4kmnw__black_female_podcaster2",
  "Voice 115": "default-e-m11vgtr9l-m7afw4kmnw__boring_guy_recording",
  "Voice 116": "default-e-m11vgtr9l-m7afw4kmnw__carolyn",
  "Voice 117": "default-e-m11vgtr9l-m7afw4kmnw__child_reporter",
  "Voice 118": "default-e-m11vgtr9l-m7afw4kmnw__christa",
  "Voice 119": "default-e-m11vgtr9l-m7afw4kmnw__colby",
  "Voice 120": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-7d768c00",
  "Voice 121": "default-e-m11vgtr9l-m7afw4kmnw__conversia_girl",
  "Voice 122": "default-e-m11vgtr9l-m7afw4kmnw__crying_woman1",
  "Voice 123": "default-e-m11vgtr9l-m7afw4kmnw__cutie_child",
  "Voice 124": "default-e-m11vgtr9l-m7afw4kmnw__death_metal_devil",
  "Voice 125": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-490b0c53",
  "Voice 126": "default-e-m11vgtr9l-m7afw4kmnw__ducky_quackster",
  "Voice 127": "default-e-m11vgtr9l-m7afw4kmnw__fara",
  "Voice 128": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-4c9f3a1e",
  "Voice 129": "default-e-m11vgtr9l-m7afw4kmnw__franny_the_nanny",
  "Voice 130": "default-e-m11vgtr9l-m7afw4kmnw__fucia_black_young_adult_or_teen",
  "Voice 131": "default-e-m11vgtr9l-m7afw4kmnw__gracie_child",
  "Voice 132": "default-e-m11vgtr9l-m7afw4kmnw__hannah",
  "Voice 133": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-770cd001",
  "Voice 134": "default-e-m11vgtr9l-m7afw4kmnw__houston_stone",
  "Voice 135": "default-e-m11vgtr9l-m7afw4kmnw__jerrimiah",
  "Voice 136": "default-e-m11vgtr9l-m7afw4kmnw__junior_cute_child",
  "Voice 137": "default-e-m11vgtr9l-m7afw4kmnw__kade_ten_years_old",
  "Voice 138": "default-e-m11vgtr9l-m7afw4kmnw__kiana_the_commedian",
  "Voice 139": "default-e-m11vgtr9l-m7afw4kmnw__lannie",
  "Voice 140": "default-e-m11vgtr9l-m7afw4kmnw__local_southern_man1",
  "Voice 141": "default-e-m11vgtr9l-m7afw4kmnw__local_southern_man_2",
  "Voice 142": "default-e-m11vgtr9l-m7afw4kmnw__male_doing_taped_interview",
  "Voice 143": "default-e-m11vgtr9l-m7afw4kmnw__mazy_podcaster_female",
  "Voice 144": "default-e-m11vgtr9l-m7afw4kmnw__megan_female_teen",
  "Voice 145": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-d0d9f95c",
  "Voice 146": "default-e-m11vgtr9l-m7afw4kmnw__nervous_female_driver",
  "Voice 147": "default-e-m11vgtr9l-m7afw4kmnw__old_guy_speech",
  "Voice 148": "default-e-m11vgtr9l-m7afw4kmnw__preacher",
  "Voice 149": "default-e-m11vgtr9l-m7afw4kmnw__preschool_show_host_female",
  "Voice 150": "default-e-m11vgtr9l-m7afw4kmnw__pukin_reporter",
  "Voice 151": "default-e-m11vgtr9l-m7afw4kmnw__quiet_guy",
  "Voice 152": "default-e-m11vgtr9l-m7afw4kmnw__reanne",
  "Voice 153": "default-e-m11vgtr9l-m7afw4kmnw__retro_strict_teacher_female",
  "Voice 154": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-3ef0834f",
  "Voice 155": "default-e-m11vgtr9l-m7afw4kmnw__ronda_snotty_sounding_child",
  "Voice 156": "default-e-m11vgtr9l-m7afw4kmnw__sadie",
  "Voice 157": "default-e-m11vgtr9l-m7afw4kmnw__sagey_child",
  "Voice 158": "default-e-m11vgtr9l-m7afw4kmnw__scarla_female_child_commercial_narrator",
  "Voice 159": "default-e-m11vgtr9l-m7afw4kmnw__scary_female_narrator",
  "Voice 160": "default-e-m11vgtr9l-m7afw4kmnw__shocked_stephen",
  "Voice 161": "default-e-m11vgtr9l-m7afw4kmnw__shy_friendly_child",
  "Voice 162": "default-e-m11vgtr9l-m7afw4kmnw__southern_man_4_with_speech_delay",
  "Voice 163": "default-e-m11vgtr9l-m7afw4kmnw__southern_stranger_danger_dude",
  "Voice 164": "default-e-m11vgtr9l-m7afw4kmnw__southern_used_car_guy",
  "Voice 165": "default-e-m11vgtr9l-m7afw4kmnw__stiff_narrator_male",
  "Voice 166": "default-e-m11vgtr9l-m7afw4kmnw__super_southern_senior_sweety",
  "Voice 167": "default-e-m11vgtr9l-m7afw4kmnw__taped_antique_female",
  "Voice 168": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-d8af8cf0",
  "Voice 169": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-0df70f81",
  "Voice 170": "default-e-m11vgtr9l-m7afw4kmnw__teen_reporter_female",
  "Voice 171": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-ce8aef66",
  "Voice 172": "default-e-m11vgtr9l-m7afw4kmnw__tom_girl",
  "Voice 173": "default-e-m11vgtr9l-m7afw4kmnw__trevor_male_kid",
  "Voice 174": "default-e-m11vgtr9l-m7afw4kmnw__zadia",
  "Voice 175": "default-e-m11vgtr9l-m7afw4kmnw__zadiana",
  "Voice 176": "Aditya",
  "Voice 177": "Amara",
  "Voice 178": "Amina",
  "Voice 179": "Andoy",
  "Voice 180": "Anjali",
  "Voice 181": "Arjun",
  "Voice 182": "Boonleng",
  "Voice 183": "Chioma",
  "Voice 184": "Dalisay",
  "Voice 185": "Dhruv",
  "Voice 186": "Emeka",
  "Voice 187": "Emil",
  "Voice 188": "Folake",
  "Voice 189": "Hana",
  "Voice 190": "Huiling",
  "Voice 191": "Ishaan",
  "Voice 192": "Junhao",
  "Voice 193": "Kabir",
  "Voice 194": "Kenji",
  "Voice 195": "Liwa",
  "Voice 196": "Maricel",
  "Voice 197": "Nadia",
  "Voice 198": "Nikhil",
  "Voice 199": "Priya",
  "Voice 200": "Ren",
  "Voice 201": "Saanvi",
  "Voice 202": "Shu",
  "Voice 203": "Tala",
  "Voice 204": "Tunde",
  "Voice 205": "Vikram",
  "Voice 206": "Wei",
  "Voice 207": "Yash",
  "Voice 208": "Zherong",
  "Voice 209": "default-e-m11vgtr9l-m7afw4kmnw__birta",
  "Voice 210": "default-e-m11vgtr9l-m7afw4kmnw__sharma",
};

// 2026-07-01 RENUMBERING (Kade's call, supervised session): her custom-made
// voices lead the catalog as Voice 1-70; the stock library follows as
// Voice 71-210. Same voices, same relative order within each group, new
// labels. Old labels can NOT be kept as aliases -- the label space collides
// ("Voice 1" old/stock vs new/custom) -- so saved client prefs are migrated
// fork-side (boot migration) and agent records were patched via the API.
//   new 1-68    <- old 108-175   (custom block)
//   new 69-70   <- old 209-210   (late custom additions)
//   new 71-177  <- old 1-107     (stock, first block)
//   new 178-210 <- old 176-208   (stock, second block)
function legacyToNewVoiceNumber(n) {
  if (n >= 108 && n <= 175) return n - 107;
  if (n === 209) return 69;
  if (n === 210) return 70;
  if (n >= 1 && n <= 107) return n + 70;
  if (n >= 176 && n <= 208) return n + 2;
  return null;
}

const NUMBERED_VOICE_ALIASES = {};
for (const [label, target] of Object.entries(NUMBERED_VOICE_ALIASES_LEGACY_2026_06)) {
  const oldN = Number(label.replace("Voice ", ""));
  const newN = legacyToNewVoiceNumber(oldN);
  if (newN == null) throw new Error(`voice renumbering: no mapping for old ${label}`);
  NUMBERED_VOICE_ALIASES[`Voice ${newN}`] = target;
}
// Startup sanity: exactly 210 unique labels, customs occupy exactly 1-70.
// A failed assertion crashes boot -> the deploy fails its health check ->
// Railway keeps the previous deploy serving. Fail-safe by construction.
if (Object.keys(NUMBERED_VOICE_ALIASES).length !== 210) {
  throw new Error(`voice renumbering: expected 210 labels, got ${Object.keys(NUMBERED_VOICE_ALIASES).length}`);
}
for (let i = 1; i <= 210; i++) {
  const t = NUMBERED_VOICE_ALIASES[`Voice ${i}`];
  if (!t) throw new Error(`voice renumbering: missing Voice ${i}`);
  const isCustom = t.startsWith("default-e-");
  if ((i <= 70) !== isCustom) {
    throw new Error(`voice renumbering: Voice ${i} custom/stock mismatch (${t})`);
  }
}

// NUMBERED_VOICE_ALIASES: "Voice N" labels -> the exact same real Inworld voice IDs
// the old friendly names pointed to (2026-07-01 numbered-voice-list rename). Additive:
// OPENAI_ALIAS_MAP and CUSTOM_VOICE_MAP stay intact so nothing that already resolved
// (including anyone's saved preference for an old name) stops working.
const VOICE_MAP = { ...OPENAI_ALIAS_MAP, ...CUSTOM_VOICE_MAP, ...NUMBERED_VOICE_ALIASES };

const MODEL_MAP = {
  "tts-1": "inworld-tts-2",
  "tts-1-hd": "inworld-tts-2",
  "gpt-4o-mini-tts": "inworld-tts-2",
  "tts-1-mini": "inworld-tts-2",
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
const MAX_CHUNK_LEN = parseInt(process.env.TTS_MAX_CHUNK_LEN || "500", 10);

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

  // A sentence's terminal .!? may be followed by closing quotes/brackets
  // (e.g. 'Nice tie."') before the whitespace boundary. Without allowing
  // them here, the global match cannot close that sentence and silently
  // SKIPS the whole quoted span -- dropping it from the audio (Kade, July
  // 2026: read-aloud was losing jokes/dialogue that ended inside quotes).
  const matches = masked.match(/[^.!?]+[.!?]+["'”’»)\]}]*(\s+|$)|[^.!?]+$/g);
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
      // Aug 18 2026 (Kade: read-aloud "pauses randomly in the middle of a
      // sentence"). This fallback used to be a BLIND slice(i, i+maxChunkLen),
      // and a blind slice lands wherever it lands: on her long Fox reply 18 of
      // 51 seams cut through the middle of a WORD ("...overseas newspapers
      // just pic" | "ked sides openly"). Each half is its own Inworld
      // utterance, so the word gets spoken as two fragments with dead air
      // between them. Back off to the last real break instead -- clause
      // punctuation if there is one in the back half of the window, else the
      // last space. Only a single unbroken 500+ char "word" (not a thing in
      // prose) still falls through to a hard cut, and the loop can never stall.
      let pos = 0;
      while (pos < sentence.length) {
        let end = Math.min(pos + maxChunkLen, sentence.length);
        if (end < sentence.length) {
          const window = sentence.slice(pos, end);
          const half = Math.floor(maxChunkLen / 2);
          const clause = Math.max(
            window.lastIndexOf(", "),
            window.lastIndexOf("; "),
            window.lastIndexOf(": "),
            window.lastIndexOf(" \u2014 "),
            window.lastIndexOf(" - ")
          );
          const space = window.lastIndexOf(" ");
          if (clause > half) end = pos + clause + 1;
          else if (space > half) end = pos + space;
        }
        if (end <= pos) end = Math.min(pos + maxChunkLen, sentence.length); // never stall
        const piece = sentence.slice(pos, end).trim();
        if (piece) chunks.push(piece);
        pos = end;
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

// Aug 7 2026 (Kade: native "refuses to generate an audio voice message" —
// Railway receipts: three Inworld 400s, "text contains only a bracketed
// speaking-style instruction and no words to speak"). Under the hotter
// steering knob a paragraph can be ONLY a %%%direction%%% (often next to a
// markdown header the scrub just emptied), which shapes into a words-free
// [bracket] chunk — Inworld hard-rejects those and one bad chunk failed the
// whole message. The rule: a direction with nothing to say says nothing —
// words-free chunks are dropped before synthesis, on every lane (single,
// fish, scenes). If NOTHING survives, the caller returns clean silence
// instead of a 500.
/* Aug 24 2026 (Part 92.14) — split a shaped chunk into the words Inworld should
 * SAY and the direction it should say them IN. With the lift on, a chunk that
 * was nothing but a direction becomes empty text plus an instruction, and the
 * words-free filter above then drops it — no request is made at all, so the
 * 400 that became her error tones cannot happen. With the lift off (env
 * KADE_TTS_INSTRUCTION_FIELD=0) the chunk is returned exactly as it arrived and
 * every lane behaves precisely as it did before. */
/* The words already spoken before chunk `i`, newest last, for
 * synthesisContext.previousRequests. Steering brackets are stripped: this is
 * context for INTONATION, and a stage direction is not something that was said.
 * Kill switch: KADE_TTS_CONTEXT=0. */
/* ── CROSS-CALL SPEECH CONTEXT (Part 92.16, Aug 24 2026) ────────────────────
 * She listened to the A/B and picked the one with context: "B sounds good."
 *
 * 92.15 gave context to chunks WITHIN one request, which covers the web lane,
 * the phone lane and scenes. It did NOT cover the one she actually hears: the
 * native app's streaming speech sends ONE SENTENCE PER HTTP CALL, so every call
 * arrived with no idea what the call before it had said — which is exactly her
 * "the previous clip sounds like it has no context to the next one."
 *
 * The fork now sends `x-kade-tts-session` (the user id) on the manual TTS lane,
 * so this holds a small expiring ring of what that seat just spoke.
 *
 * DELIBERATE LIMITS, because this is a cache of people's speech:
 *   · TEXT ONLY, in memory, never written down, never logged beyond a count.
 *   · TTL 90s. Sentences of one reply arrive seconds apart; a gap longer than
 *     this is a different moment and stale context is worse than none.
 *   · Keyed per seat, so two people can never pool into one context.
 *   · Bounded: TTS_CONTEXT_MAX entries per seat, and the whole map is swept on
 *     write so an idle seat cannot hold text in memory indefinitely.
 *   · No key, no ring. An absent header is not a shared bucket. */
const TTS_SESSION_TTL_MS = Number(process.env.KADE_TTS_CONTEXT_TTL_MS || 90000);
const ttsSessions = new Map();
function sessionContext(key) {
  if (!TTS_CONTEXT_ON || !key) return null;
  const row = ttsSessions.get(key);
  if (!row) return null;
  if (Date.now() - row.at > TTS_SESSION_TTL_MS) { ttsSessions.delete(key); return null; }
  return row.texts.length ? row.texts.slice() : null;
}
function rememberSpoken(key, text) {
  if (!TTS_CONTEXT_ON || !key) return;
  const clean = String(text || "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return;
  const now = Date.now();
  for (const [k, v] of ttsSessions) if (now - v.at > TTS_SESSION_TTL_MS) ttsSessions.delete(k);
  const row = ttsSessions.get(key) || { texts: [], at: now };
  row.texts.push(clean);
  if (row.texts.length > TTS_CONTEXT_MAX) row.texts = row.texts.slice(-TTS_CONTEXT_MAX);
  row.at = now;
  ttsSessions.set(key, row);
}

const TTS_CONTEXT_MAX = Number(process.env.KADE_TTS_CONTEXT_MAX || 3);
const TTS_CONTEXT_ON = process.env.KADE_TTS_CONTEXT !== "0";
function contextFor(chunks, i, sessionKey) {
  if (!TTS_CONTEXT_ON) return null;
  const prior = sessionContext(sessionKey) || [];
  const within = chunks
    .slice(Math.max(0, i - TTS_CONTEXT_MAX), i)
    .map((c) => String(c).replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  /* Oldest first, and this request's own earlier chunks are nearer in time than
   * anything from the previous call, so they go last. */
  const out = prior.concat(within).slice(-TTS_CONTEXT_MAX);
  if (!out.length) return null;
  /* Same reason the lift logs: without a line at the point it happens, nobody
   * can tell from production whether this is on. Prints how many prior
   * sentences this chunk was told about. */
  console.log(`[TTS] context -> chunk ${i} carries ${out.length} prior piece(s)`);
  return out;
}

function splitChunkForInworld(chunk) {
  if (!TTS_INSTRUCTION_FIELD) return { text: chunk, instruction: null };
  const out = liftInstruction(chunk);
  /* The existing "[TTS] input len=" line is printed BEFORE chunking, so it
   * still shows the tag inside the text and cannot show whether the lift
   * happened. Without this line the change is invisible in production, which
   * is the same disease as a monitor that never tests what people use. It also
   * carries the number that matters: Inworld bills processed characters, and
   * those are characters no longer being billed. */
  if (out.instruction) {
    const saved = chunk.length - out.text.length;
    console.log(`[TTS] steering -> instruction field (${saved} chars off the billed text): ${JSON.stringify(out.instruction.slice(0, 80))}`);
  }
  return out;
}

function chunkHasSpeakableWords(chunk) {
  return /[a-zA-Z0-9]/.test(String(chunk || "").replace(/\[[^\]]*\]/g, " "));
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

// Aug 6 2026 (Kade: "you can tell it's being read in sections... more loose"):
// the comment said ~140ms but the value had drifted to 350 -- a third of a
// second of dead air at EVERY paragraph joint reads as sectioning. Down to
// 160ms (a natural beat, not a stop), env-tunable for her future taste.
// MAX_CHUNK_LEN stays 500 on purpose (the June-27 receipt: one 1600-char
// Inworld call takes 60-90s; parallelism IS the no-dead-air design) but is
// env-tunable now too. The other half of the seam fix is content-side: the
// platform note teaches direction CHANGES at paragraph turns (a new mood
// makes the joint sound like a gear change, not a reader's breath).
// ⚠️ AUG 18 2026 — GAP_MS NOW MEANS THE WHOLE SEAM, NOT AN ADDITION TO IT.
// Kade: read-aloud "pauses randomly in the middle of a sentence... like there
// are commas in places they shouldn't be." Measured on her actual voice
// (Voice 578 Jadabell) against the live service: every chunk Inworld returns
// carries 460-605ms of its own TRAILING silence and 15-65ms of leading
// silence. We were butting that ragged tail straight against 160ms of our
// own gap, so a real seam measured ~655ms while a natural sentence break
// INSIDE a chunk measured ~410ms. Every seam was therefore one-and-a-half
// periods long -- audible as an extra comma, and completely invisible in the
// code because the 160 constant looked modest.
//
// Fix: trim the provider's own silence off the inner edges first, then insert
// exactly GAP_MS. GAP_MS's default moves 160 -> 340 because it is now the
// ENTIRE seam and has to stand in for the sentence break it replaces (aiming
// just under Inworld's own ~410ms so seams read as breaths, not stops).
// TTS_TRIM_SEAMS=0 restores the old butt-splice exactly. Outer edges are
// deliberately NOT trimmed -- clipping the first phoneme or the last word is
// a worse bug than a little air at the ends.
const GAP_MS = parseInt(process.env.TTS_GAP_MS || "340", 10);
const TRIM_SEAMS = process.env.TTS_TRIM_SEAMS !== "0";
// Never eat more than this much from one edge: if a chunk really does end in
// a long deliberate silence, that is the model performing, not slop.
const MAX_TRIM_MS = parseInt(process.env.TTS_MAX_TRIM_MS || "900", 10);

function buildSilence(ms, { sampleRate, numChannels, bitsPerSample }) {
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.round((sampleRate * ms) / 1000);
  return Buffer.alloc(samples * numChannels * bytesPerSample, 0);
}

// Trim provider silence off one or both edges of a 16-bit PCM buffer.
// Threshold is relative to the clip's own peak (so a quiet voice is not
// treated as silence) with an absolute floor for near-silent clips. Fully
// fail-soft: anything unexpected returns the buffer untouched.
function trimEdgeSilence(pcm, fmt, { head = false, tail = false } = {}) {
  try {
    if (!TRIM_SEAMS || !pcm || !pcm.length || fmt.bitsPerSample !== 16) return pcm;
    const frame = fmt.numChannels * 2;                 // bytes per sample frame
    const win = Math.max(1, Math.round(fmt.sampleRate * 0.005)) * frame; // 5ms
    const total = Math.floor(pcm.length / win);
    if (total < 4) return pcm;
    let peak = 0;
    const rms = new Float64Array(total);
    for (let w = 0; w < total; w++) {
      let sum = 0;
      const base = w * win;
      for (let b = base; b < base + win; b += 2) { const v = pcm.readInt16LE(b); sum += v * v; }
      const r = Math.sqrt(sum / (win / 2));
      rms[w] = r;
      if (r > peak) peak = r;
    }
    const thr = Math.max(peak * 0.01, 60);
    let first = 0, last = total - 1;
    while (first < total && rms[first] < thr) first++;
    while (last > first && rms[last] < thr) last--;
    if (first >= last) return pcm;                     // all silence: leave it alone
    const maxWin = Math.round(MAX_TRIM_MS / 5);
    const startWin = head ? Math.min(first, maxWin) : 0;
    const endWin = tail ? Math.min(total - 1 - last, maxWin) : 0;
    if (!startWin && !endWin) return pcm;
    const out = pcm.slice(startWin * win, pcm.length - endWin * win);
    return out.length ? out : pcm;
  } catch (err) {
    console.warn(`[TTS] seam trim skipped (${err.message})`);
    return pcm;
  }
}


// ── μ-law 8kHz output for Twilio Media Streams (telephony=1 mode) ─────────────
// The voice-stream.js bridge pulls /v1/audio/speech?telephony=1 to get raw
// G.711 μ-law at 8kHz instead of WAV — that's the exact format Twilio's Media
// Streams expects. We downsample Inworld's 24kHz PCM, then μ-law-encode it.

// Simple averaging downsampler (24kHz PCM → 8kHz PCM, 16-bit LE)
function downsamplePcm(pcmBuf, fromRate, toRate) {
  if (fromRate === toRate) return pcmBuf;
  const ratio = fromRate / toRate;
  const outSamples = Math.floor(pcmBuf.length / 2 / ratio);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const s0 = Math.floor(i * ratio);
    const s1 = Math.min(Math.floor((i + 1) * ratio), pcmBuf.length / 2);
    let sum = 0, n = 0;
    for (let j = s0; j < s1; j++) { sum += pcmBuf.readInt16LE(j * 2); n++; }
    out.writeInt16LE(n ? Math.round(sum / n) : 0, i * 2);
  }
  return out;
}

// Short linear fade-in/out at the edges of a PCM buffer (default 40 samples
// = 5ms @ 8kHz). TTS-2 clips can start/stop at non-zero amplitude, and an
// abrupt step to/from silence is heard as a snap/click on the phone line --
// this ramps the edges so utterance boundaries are inaudible. Added July 1
// 2026 alongside the bridge's mu-law padding fix (the other click source).
function fadePcmEdges(pcmBuf, fadeSamples = 96) {  // 96 = 12ms @ 8kHz (5ms proved too short July 1)
  const total = pcmBuf.length >> 1;
  const n = Math.min(fadeSamples, total >> 1);
  for (let i = 0; i < n; i++) {
    const gain = i / n;
    pcmBuf.writeInt16LE(Math.round(pcmBuf.readInt16LE(i * 2) * gain), i * 2);
    const j = total - 1 - i;
    pcmBuf.writeInt16LE(Math.round(pcmBuf.readInt16LE(j * 2) * gain), j * 2);
  }
  return pcmBuf;
}

// ITU-T G.711 μ-law encoder (16-bit signed PCM → 8-bit μ-law byte)
const MULAW_BIAS = 33;
function encodeMulaw(s16) {
  let s = s16;
  const sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  s += MULAW_BIAS;
  if (s > 32767) s = 32767;
  let exp = 7;
  for (let mask = 0x4000; !(s & mask) && exp > 0; exp--, mask >>= 1) {}
  const mantissa = (s >> (exp + 3)) & 0x0F;
  return (~(sign | (exp << 4) | mantissa)) & 0xFF;
}

function pcm16ToMulaw(pcmBuf) {
  const out = Buffer.alloc(pcmBuf.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = encodeMulaw(pcmBuf.readInt16LE(i * 2));
  }
  return out;
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

// Hard cap on a single Inworld request. Without this, a hung upstream call
// (a) never resolves, so the caller waits forever (the July 1 phone-greeting
// hang: request logged, no response, no error -- and the bridge rang forever),
// and (b) permanently eats one of the limiter's 6 slots, quietly shrinking
// capacity until the whole proxy starves. Timeouts are retryable below.
const INWORLD_TIMEOUT_MS = 20000;

async function synthesizeChunkOnce(text, voiceId, modelId, speakingRate, instruction, previousTexts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), INWORLD_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.inworld.ai/tts/v1/voice", {
    signal: ac.signal,
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
        speakingRate: speakingRate != null ? speakingRate : TTS_SPEAKING_RATE,
      },
      // Only takes effect on inworld-tts-2 (which is the only model this
      // proxy ever actually requests -- see MODEL_MAP). CREATIVE = "optimizes
      // for increased emotional range and variation" per Inworld's docs.
      deliveryMode: TTS_DELIVERY_MODE,
      /* Aug 24 2026 — the steering direction rides its OWN FIELD now instead of
       * being pasted into the text as a [bracket]. Same endpoint, documented
       * on inworld-tts-2, verified live. Two things this buys:
       *   1. A chunk can no longer consist of ONLY a direction, because the
       *      direction is not in the text. That is the 400 that became her
       *      error tones on build 241, retired by construction.
       *   2. It is not billed. Inworld bills processed characters and an inline
       *      tag is processed characters — 161 vs 97 on the same test sentence,
       *      and 30% of her real reply's 5,400 characters were tags. */
      ...(instruction ? { instruction } : {}),
      /* Aug 24 2026 (Part 92.15) — TELL EACH CHUNK WHAT CAME BEFORE IT.
       * Kade, on hearing the class-retirement work: "that context thing… where
       * the previous clip sounds like it has no context to the next one?" That
       * is exactly the artifact, and Inworld names it in their own guide:
       * "Speech doesn't happen in a vacuum: how 'Yeah.' should sound depends
       * entirely on what came before it… especially for short or ambiguous
       * input where the text alone doesn't determine the right intonation."
       * A long reply is split into several requests here, and every one of them
       * was being synthesised blind — so pitch, energy and cadence reset at
       * every boundary and the pieces sounded stapled together.
       * FREE IN LATENCY: this is TEXT WE ALREADY HAVE before any request is
       * made, so the chunks still fire in parallel. Nothing waits on anything.
       * Capped because context is billed as characters and the marginal value
       * of a fifth sentence back is not worth paying for. */
      ...(previousTexts && previousTexts.length
        ? { synthesisContext: { previousRequests: previousTexts.map((t) => ({ text: t })) } }
        : {}),
    }),
  });

  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error(`Inworld request timed out after ${INWORLD_TIMEOUT_MS}ms`);
      e.isTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`Inworld API error ${response.status}: ${errorText}`);
    err.status = response.status;
    err.isRateLimit = response.status === 429;
    /* ⭐ AUG 28 2026 — A 5xx WAS THE ONE TRANSIENT SHAPE THIS LANE REFUSED
     * TO RETRY, AND ITS OWN SIBLING TWENTY LINES DOWN ALWAYS HAS.
     * fishSynthesizeChunkOnce sets isServerErr and fishSynthesizeChunk
     * retries on it; this function set only isRateLimit, so an Inworld 502
     * or 503 threw straight past a four-attempt backoff ladder that was
     * sitting right there. Same upstream class, same ladder, opposite
     * manners — the same shape as the Aug-26 announcement-priority bug,
     * where two handlers eight lines apart disagreed with each other.
     * Her Aug-28 report ("one of the sections of voiceclip gave an error
     * sound") is a chunk that died and did not come back; this is the half
     * of that fix which lives on the server. */
    err.isServerErr = response.status >= 500;
    throw err;
  }

  const data = await response.json();
  if (!data.audioContent) {
    throw new Error("No audioContent in Inworld response");
  }

  return Buffer.from(data.audioContent, "base64");
}

/* ⭐ AUG 28 2026 — COUNT THE CHUNKS THAT DIE.
 *
 * Her Aug-28 morning report could not be convicted from logs, because the
 * proxy redeployed at 07:00Z and took the log window with it. A failure
 * nobody can count is a failure that gets argued about instead of fixed.
 *
 * Deliberately IN MEMORY and deliberately small: a redeploy resets it, and
 * that is fine — this is a tripwire for "is the voice lane bleeding TODAY",
 * not an accounting ledger. The durable version is the deploywatch probe,
 * which lives on a volume for exactly the reason this does not need to.
 * Keys are Central days so the number lines up with the day she describes.
 * Values are counts. No text, no voice ids, nothing about who was talking. */
const chunkStats = new Map(); // 'YYYY-MM-DD' -> { ok, failed, retried }
function centralDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
}
function noteChunk(kind) {
  const day = centralDay();
  let row = chunkStats.get(day);
  if (!row) {
    row = { ok: 0, failed: 0, retried: 0 };
    chunkStats.set(day, row);
  }
  row[kind] = (row[kind] || 0) + 1;
  /* Keep three days and no more; this is a tripwire, not a warehouse.
   * ⚠️ The trim runs on EVERY note, not only when a new day is created.
   * The first version trimmed inside the `if (!row)` above — correct in the
   * only scenario it was imagined in (midnight rolls, a new row appears,
   * the oldest falls off) and unbounded in every other one. Its own test
   * caught it holding five days. Trimming a Map of at most four keys costs
   * nothing; a bound that only holds on the happy path is not a bound. */
  for (const k of [...chunkStats.keys()].sort().slice(0, -3)) chunkStats.delete(k);
}
function chunkStatsToday() {
  return chunkStats.get(centralDay()) || { ok: 0, failed: 0, retried: 0 };
}

async function synthesizeChunk(text, voiceId, modelId, speakingRate, instruction, previousTexts) {
  return inworldLimiter(async () => {
    const maxAttempts = 4;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const buf = await synthesizeChunkOnce(text, voiceId, modelId, speakingRate, instruction, previousTexts);
        noteChunk('ok');
        if (attempt > 1) noteChunk('retried');
        return buf;
      } catch (err) {
        lastErr = err;
        const retryable = err.isRateLimit || err.isTimeout || err.isServerErr;
        if (!retryable || attempt === maxAttempts) { noteChunk('failed'); throw err; }
        console.warn(`[TTS] chunk attempt ${attempt}/${maxAttempts} failed (${err.message}) -- retrying`);
        // Backoff with a little jitter so retries from a batch of chunks
        // don't all collide on the same retry tick.
        await sleep(300 * attempt + Math.random() * 200);
      }
    }
    throw lastErr;
  });
}

/* ── Part 98 (Aug 29 2026) — THE STREAMED SINGLE-CHUNK LANE ──────────────────
 *
 * The app lane sends ONE SENTENCE PER HTTP CALL (see the 92.16 note in the
 * fork's TTSService), and that sentence's whole synthesis was the ding→voice
 * floor. This function synthesizes that one chunk via Inworld's voice:stream
 * endpoint and flushes audio to the caller AS IT ARRIVES: measured tonight,
 * first bytes at ~438ms vs ~1.9s for the whole clip.
 *
 * CONTRACT: returns true when it HANDLED the response (bytes flushed, or a
 * clean end after flushing), false when it sent NOTHING and the caller must
 * fall through to the buffered path. Once a byte is flushed there is no
 * fallback — a mid-stream death ends the response and the app hears a short
 * clip (its pump already treats a short piece as a piece, and the probe's
 * duration baseline catches systematic truncation).
 *
 * What this lane deliberately does NOT do, and why that is safe on a single
 * chunk: no seam silence and no inner-edge trims (both are multi-chunk
 * concepts — the buffered path applies neither to a single chunk), no tail
 * fade (the end is unknowable mid-stream; Inworld ends clips in 460-605ms of
 * trailing silence, so a tail click has nothing to click against), and no
 * same-pass EMA update (normalizeLoudness runs in measureOnly mode on the
 * accumulated raw PCM after the stream ends — memory stays one clip behind,
 * inside normal clip-to-clip wobble).
 *
 * Retry manners: the buffered path's 4-attempt ladder lives in
 * synthesizeChunk, and a handshake failure here (connect error, non-200, or
 * an upstream error line before any audio) returns false so THAT ladder still
 * runs. The stream lane never retries on its own — retrying after flushed
 * bytes would double-speak the opening of a sentence.
 */
async function tryStreamSingleChunk(res, { chunk, inworldVoice, inworldModel, speakingRate, previousTexts, voiceLabel }) {
  const { text: sayText, instruction } = splitChunkForInworld(chunk);
  if (!sayText || !sayText.trim()) return false;
  return inworldLimiter(async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), INWORLD_TIMEOUT_MS);
    const t0 = Date.now();
    let response;
    try {
      response = await fetch("https://api.inworld.ai/tts/v1/voice:stream", {
        signal: ac.signal,
        method: "POST",
        headers: {
          Authorization: `Basic ${INWORLD_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: sayText,
          voiceId: inworldVoice,
          modelId: inworldModel,
          audioConfig: {
            audioEncoding: "WAV",
            sampleRateHertz: 24000,
            speakingRate: speakingRate != null ? speakingRate : TTS_SPEAKING_RATE,
          },
          deliveryMode: TTS_DELIVERY_MODE,
          ...(instruction ? { instruction } : {}),
          ...(previousTexts && previousTexts.length
            ? { synthesisContext: { previousRequests: previousTexts.map((t) => ({ text: t })) } }
            : {}),
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[TTS] stream: handshake failed (${err.message}) -- falling back to buffered`);
      return false;
    }
    if (!response.ok || !response.body) {
      clearTimeout(timer);
      const errText = await response.text().catch(() => "");
      console.warn(`[TTS] stream: HTTP ${response.status} -- falling back to buffered (${errText.slice(0, 160)})`);
      return false;
    }

    const parser = createNdjsonAudioParser();
    let processor = null;
    let headerBuf = null; // accumulates until the WAV header is sniffable
    let rawPcm = []; // pre-gain PCM, for the measure-only EMA update after
    let flushedBytes = 0;
    let firstAudioMs = null;
    let sentHeaders = false;

    const beginResponse = (fmt) => {
      res.set("Content-Type", "audio/wav");
      res.set("x-kade-tts-streamed", "1");
      res.write(buildStreamingWavHeader(fmt));
      sentHeaders = true;
    };

    try {
      for await (const piece of response.body) {
        const audioBufs = parser.feed(Buffer.from(piece));
        for (const audio of audioBufs) {
          if (firstAudioMs == null) firstAudioMs = Date.now() - t0;
          let pcm;
          if (!processor) {
            headerBuf = headerBuf ? Buffer.concat([headerBuf, audio]) : audio;
            const sniffed = sniffWavFormat(headerBuf);
            if (!sniffed) continue; // torn header: accumulate and retry
            const { fmt, pcmStart } = sniffed;
            const remembered = TTS_NORM_ENABLED ? voiceGainMemory.get(inworldVoice) : 1.0;
            processor = createStreamProcessor({
              gain: remembered,
              knee: TTS_NORM_KNEE,
              kneeRange: TTS_NORM_KNEE_RANGE,
              fadeInSamples: Math.max(48, Math.round(fmt.sampleRate * 0.005)),
            });
            processor.fmt = fmt;
            beginResponse(fmt);
            pcm = headerBuf.slice(pcmStart);
            headerBuf = null;
          } else {
            pcm = audio;
          }
          if (!pcm.length) continue;
          rawPcm.push(Buffer.from(pcm));
          const out = processor.process(pcm);
          if (out.length) {
            res.write(out);
            flushedBytes += out.length;
          }
        }
      }
      for (const audio of parser.flush()) {
        if (processor) {
          rawPcm.push(Buffer.from(audio));
          const out = processor.process(audio);
          if (out.length) {
            res.write(out);
            flushedBytes += out.length;
          }
        }
      }
    } catch (err) {
      clearTimeout(timer);
      if (!sentHeaders) {
        console.warn(`[TTS] stream: died before first audio (${err.message}) -- falling back to buffered`);
        return false;
      }
      noteChunk("failed");
      console.error(`[TTS] stream: died mid-clip after ${flushedBytes} bytes (${err.message}) -- ending short`);
      res.end();
      return true;
    }
    clearTimeout(timer);

    if (!sentHeaders) {
      // Stream ended without ever yielding a sniffable header — treat as a
      // failed handshake and let the buffered ladder have it.
      console.warn(`[TTS] stream: ended with no audio -- falling back to buffered`);
      return false;
    }

    res.end();
    noteChunk("ok");
    const raw = Buffer.concat(rawPcm);
    if (processor.fmt) {
      normalizeLoudness(raw, processor.fmt.sampleRate, inworldVoice, { measureOnly: true });
    }
    console.log(
      `[TTS] stream out: label="${voiceLabel}" resolved="${inworldVoice}" first-audio ${firstAudioMs}ms total ${Date.now() - t0}ms bytes=${flushedBytes} gain=${processor.appliedGain.toFixed(3)}`
    );
    return true;
  });
}

// ── Fish Audio synthesis (sibling of synthesizeChunk above) ──────────────────
// POST api.fish.audio/v1/tts returns RAW AUDIO BYTES (not base64). We request
// `pcm` (s16le mono) at 24kHz — deliberately NOT `wav`: fish streams its WAV
// with placeholder RIFF/data sizes (0xffffff24 seen live July 22 2026), which
// parseWav must never be trusted with. Raw PCM + our own buildWavHeader gives
// fishSynthesizeChunk the exact same return shape as the Inworld path, so
// every downstream stage stays provider-blind.
const FISH_TIMEOUT_MS = parseInt(process.env.FISH_TIMEOUT_MS || "30000", 10);
// Fish caps concurrency account-wide by lifetime top-up tier (Kade's account:
// ≥$100 paid → 15 concurrent). 6 mirrors the Inworld headroom philosophy —
// well under the ceiling so auditions/other users never starve a reply.
const MAX_CONCURRENT_FISH_CALLS = parseInt(process.env.FISH_MAX_CONCURRENT || "6", 10);
const fishLimiter = createLimiter(MAX_CONCURRENT_FISH_CALLS);
const FISH_SAMPLE_RATE = 24000; // matches Inworld's 24k so mixed-provider EMA/telephony math never diverges

async function fishSynthesizeChunkOnce(text, fishModelId, speakingRate) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FISH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.fish.audio/v1/tts", {
      signal: ac.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${FISH_API_KEY}`,
        "Content-Type": "application/json",
        model: FISH_TTS_MODEL, // tier lives in a HEADER on fish's API, not the body
      },
      body: JSON.stringify({
        text,
        reference_id: fishModelId,
        format: "pcm",
        sample_rate: FISH_SAMPLE_RATE,
        latency: FISH_TTS_LATENCY,
        // Aug 6 2026 (Kade: "hopefully fish is tuned to be as expressive as it
        // can be... temp and whatever else"): fish's own docs — temperature
        // "controls expressiveness, higher is more varied" (0-1, default 0.7).
        // We never sent it = stock 0.7 the whole time. 0.9 = expressive with a
        // margin off the hallucination edge; both knobs env-tunable.
        temperature: FISH_TEMPERATURE,
        top_p: FISH_TOP_P,
        prosody: {
          // Fish accepts 0.5–2.0; the endpoint's shared clamp (0.5–1.5, chosen
          // for Inworld parity) arrives here already sane.
          speed: speakingRate != null ? speakingRate : FISH_TTS_SPEED,
        },
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error(`Fish request timed out after ${FISH_TIMEOUT_MS}ms`);
      e.isTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`Fish API error ${response.status}: ${errorText}`);
    err.status = response.status;
    err.isRateLimit = response.status === 429;
    // 402 = fish credit ran dry — surface loudly, never retry (it can't heal).
    if (response.status === 402) err.message += " (fish.audio API credit exhausted — top up at fish.audio)";
    // Fish is a newer upstream than Inworld for us: treat transient 5xx as
    // retryable too (bounded by the same 4-attempt backoff ladder).
    err.isServerErr = response.status >= 500;
    throw err;
  }

  let pcm = Buffer.from(await response.arrayBuffer());
  if (!pcm.length) throw new Error("Empty audio from Fish API");
  if (pcm.length % 2) pcm = pcm.slice(0, pcm.length - 1); // s16 alignment guard
  const fmt = { numChannels: 1, sampleRate: FISH_SAMPLE_RATE, bitsPerSample: 16 };
  return Buffer.concat([buildWavHeader(pcm.length, fmt), pcm]);
}

async function fishSynthesizeChunk(text, fishModelId, speakingRate) {
  return fishLimiter(async () => {
    const maxAttempts = 4;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const buf = await fishSynthesizeChunkOnce(text, fishModelId, speakingRate);
        noteChunk('ok');
        if (attempt > 1) noteChunk('retried');
        return buf;
      } catch (err) {
        lastErr = err;
        const retryable = err.isRateLimit || err.isTimeout || err.isServerErr;
        if (!retryable || attempt === maxAttempts) { noteChunk('failed'); throw err; }
        console.warn(`[TTS] fish chunk attempt ${attempt}/${maxAttempts} failed (${err.message}) -- retrying`);
        await sleep(300 * attempt + Math.random() * 200);
      }
    }
    throw lastErr;
  });
}

app.get("/health", (req, res) => {
  /* The voice numbers ride /health because /health is the thing that already
   * gets read — by deploywatch every few minutes and by the platform snapshot
   * every sync. A counter nobody reads is the memory-health `warnings[]`
   * lesson all over again: the endpoint published the truth for three days
   * while nobody consumed it. */
  const today = chunkStatsToday();
  const total = today.ok + today.failed;
  res.json({
    status: "ok",
    service: "inworld-tts-proxy",
    chunksToday: {
      ...today,
      day: centralDay(),
      failRatePct: total ? Math.round((today.failed / total) * 1000) / 10 : 0,
      spoken: total === 0
        ? "No voice chunks synthesised yet today."
        : `${today.ok} voice chunks synthesised today, ${today.failed} failed outright` +
          `${today.retried ? `, ${today.retried} needed a retry first` : ""}.`,
    },
  });
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
  return text
    .replace(/:::thinking[\s\S]*?:::\n?/g, "")     // legacy :::thinking::: marker
    .replace(/<think>[\s\S]*?<\/think>\n?/g, "") // <think>...</think> from reframe-proxy
    .replace(/\uF001[\s\S]*?\uF002/g, "")        // PUA-wrapped reasoning text (extracted from think part by LibreChat before sending to TTS)
    .trim();
}

// Aug 6 2026 (Kade, native this morning: voices "reading star star or number
// sign or asterisk" — fish especially reads markdown literally where inworld
// mostly shrugs). The platform note asks characters for speakable prose, but
// models still emit markdown on listy replies; this is the deterministic net.
// Markers vanish, TEXT SURVIVES: **bold**/*italic*/__underline__ keep their
// words, headers lose their #, list bullets become plain lines, [text](url)
// keeps text, code ticks drop, table pipes become spaces. Runs BEFORE
// applySteeringTags so %%% sentinels are untouched, and never touches bare
// [bracket] spans (fish emotion cues ride those after conversion).
function stripSpeechMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\|/g, " ")
    // Inline hardening (Aug 6, second pass — the live receipt caught a
    // mid-sentence "##" spoken as "hash hash"; the header rule only fired at
    // line starts). Runs of #/* anywhere are formatting, never speech; a
    // lone # before a digit is spoken as "number".
    .replace(/#(?=\d)/g, "number ")
    .replace(/#{2,}/g, "")
    .replace(/\*{2,}/g, "")
    .replace(/[ \t]{2,}/g, " ");
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
    // KADE July 11 2026: models sometimes type "\u00A0" LITERALLY in prose
    // (escape habit learned from the citation format; seen live from Hermes
    // 405B). Never voice it -- speak a normal space.
    .replace(/\\u00a0/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

// ── Spoken-text normalizer (Aug 7 2026, her ask: "dot com websites and
// numbers get butchered — convert those into a TTS-friendly format, voice
// only") ─────────────────────────────────────────────────────────────────────
// The industry name for this layer is TEXT NORMALIZATION — every serious TTS
// front-end (Polly, Azure, espeak) runs one before synthesis: expand the
// things writing-notation says but a voice shouldn't read literally. Ours is
// deterministic, ordered, and AUDIO-ONLY: it sits in the prep chain between
// markdown-strip and the pronunciation lexicon, so the visible chat text is
// never touched and user lexicon entries still win afterward.
//
// ORDER MATTERS and is load-bearing: emails before URLs (an email contains a
// domain), ISO dates before phone numbers and ranges (2026-08-07 must never
// become a phone group or "2026 to 08"), money before bare-number ranges
// ($3-6 → dollars first, then "to"), phones before ranges (417-555-1234 is
// digits, not arithmetic). Every rule is conservative on purpose — when in
// doubt a shape is LEFT ALONE, because a wrong expansion is worse to the ear
// than a robotic read. Kill switch: KADE_TTS_NORMALIZE=0.
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TLD_SPOKEN = 'com|org|net|edu|gov|io|ai|app|dev|co|us|fm|tv|me|audio|info|biz';

function speakDigits(s) {
  return String(s).replace(/\D/g, '').split('').join(' ');
}

function normalizeForSpeech(text) {
  if (!text || process.env.KADE_TTS_NORMALIZE === '0') return text;
  let t = String(text);

  // 1) EMAILS → "name at domain dot tld" (before URLs — an email contains a domain)
  t = t.replace(/\b([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\.([a-zA-Z]{2,10})\b/g, (_, user, dom, tld) => {
    return `${user.replace(/\./g, ' dot ')} at ${dom.replace(/\./g, ' dot ')} dot ${tld}`;
  });

  // 2+3) URLS AND BARE DOMAINS, one path-aware rule — protocol and www are
  //    dropped, dots become "dot", short paths become "slash" words, and long
  //    or query-stringed paths collapse to just the domain (nobody wants a
  //    UTM parameter performed dramatically). File names like server.js and
  //    decimals like 3.14 are safe: the last label must be a real TLD word.
  t = t.replace(
    new RegExp(String.raw`(?:\bhttps?:\/\/(?:www\.)?|\b)((?:[a-zA-Z0-9-]+\.)+(?:${TLD_SPOKEN}))\b(\/[^\s)\]}"'<>]*)?`, 'g'),
    (_, host, path) => {
      const spokenHost = host.replace(/\./g, ' dot ');
      if (!path || path === '/') return spokenHost;
      const clean = path.replace(/[?#].*$/, '');
      const segs = clean.split('/').filter(Boolean);
      if (segs.length === 0 || segs.length > 3 || clean.length > 40) return spokenHost;
      return `${spokenHost} slash ${segs.join(' slash ')}`;
    },
  );

  // 4) ISO DATES 2026-08-07 → "August 7, 2026" (before phones/ranges ever see the digits)
  t = t.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (_, y, mo, d) => {
    const mi = parseInt(mo, 10);
    const di = parseInt(d, 10);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return `${y}-${mo}-${d}`;
    return `${MONTH_NAMES[mi - 1]} ${di}, ${y}`;
  });

  // 5) US PHONE NUMBERS → spoken digit groups with pause periods
  //    (417) 555-1234 / 417-555-1234 / +1 417 555 1234 → "4 1 7. 5 5 5. 1 2 3 4"
  t = t.replace(/(?:\+1[-. ]?)?\(?(\d{3})\)?[-. ](\d{3})[-. ](\d{4})\b/g, (_, a, b, c) => {
    return `${speakDigits(a)}. ${speakDigits(b)}. ${speakDigits(c)}`;
  });

  // 6a) MONEY RANGES first ($3-6 → "3 to 6 dollars") so the plain money rule
  //     never leaves a dangling "-6" behind
  t = t.replace(/\$(\d{1,4})\s?-\s?\$?(\d{1,4})\b/g, '$1 to $2 dollars');

  // 6) MONEY → words. $4.99 "4 dollars and 99 cents", $10 "10 dollars",
  //    $0.20 "20 cents", $1 "1 dollar", $1.5M-style left alone (letters after).
  t = t.replace(/\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?(?![\d.,]?[a-zA-Z])/g, (_, whole, cents) => {
    const w = whole.replace(/,/g, '');
    const wn = parseInt(w, 10);
    const dollarWord = wn === 1 ? 'dollar' : 'dollars';
    if (cents && cents !== '00') {
      if (wn === 0) return `${parseInt(cents, 10)} cents`;
      return `${whole} ${dollarWord} and ${parseInt(cents, 10)} cents`;
    }
    return `${whole} ${dollarWord}`;
  });

  // 7) PERCENT → the word (92% → "92 percent")
  t = t.replace(/(\d+(?:\.\d+)?)\s?%/g, '$1 percent');

  // 8) UNITS the voice mangles: data sizes, mph, degrees
  const UNIT_WORDS = { KB: 'kilobytes', MB: 'megabytes', GB: 'gigabytes', TB: 'terabytes' };
  t = t.replace(/\b(\d+(?:\.\d+)?)\s?(KB|MB|GB|TB)\b/g, (_, n, u) => `${n} ${UNIT_WORDS[u]}`);
  t = t.replace(/\b(\d+(?:\.\d+)?)\s?mph\b/gi, '$1 miles an hour');
  t = t.replace(/(\d+(?:\.\d+)?)\s?°\s?F\b/g, '$1 degrees Fahrenheit');
  t = t.replace(/(\d+(?:\.\d+)?)\s?°\s?C\b/g, '$1 degrees Celsius');
  t = t.replace(/(\d+(?:\.\d+)?)\s?°(?![FC])/g, '$1 degrees');

  // 9) BARE 24-HOUR TIMES → 12-hour (17:30 → "5:30 PM"). Only hours 13-23
  //    convert (unambiguously 24-hour); anything else could be a ratio or
  //    verse and is left alone. Times already wearing am/pm are untouched.
  t = t.replace(/\b(1[3-9]|2[0-3]):([0-5]\d)\b(?!\s?[apAP]\.?[mM])/g, (_, h, m) => {
    return `${parseInt(h, 10) - 12}:${m} PM`;
  });
  t = t.replace(/\b00:([0-5]\d)\b/g, '12:$1 AM');

  // 10) NUMBER RANGES 2-3 / 5 - 10 → "2 to 3" (dates and phones already
  //     consumed their digits above; leading zeros bow out so 08-07 style
  //     date fragments are never misread as arithmetic)
  t = t.replace(/(?<![\d.])(\d{1,4})\s?-\s?(\d{1,4})(?![\d.%-])/g, (m, a, b) => {
    if (a.length > 1 && a[0] === '0') return m;
    if (b.length > 1 && b[0] === '0') return m;
    return `${a} to ${b}`;
  });

  // 11) RATE NOTATION a voice reads as "slash mo": /mo /yr /day /hr /wk
  t = t.replace(/\/mo(?:nth)?\b/g, ' a month');
  t = t.replace(/\/yr\b|\/year\b/g, ' a year');
  t = t.replace(/\/day\b/g, ' a day');
  t = t.replace(/\/hr\b|\/hour\b/g, ' an hour');
  t = t.replace(/\/wk\b|\/week\b/g, ' a week');

  // 12) SYMBOLS a voice shouldn't skip: standalone & → and, ~ before a number
  //     → "about " (unless the word about is already sitting right there)
  t = t.replace(/\s&\s/g, ' and ');
  t = t.replace(/\babout\s+~\s?/gi, 'about ');
  t = t.replace(/~\s?(?=\d|\$)/g, 'about ');

  // 13) WRITTEN-ONLY ABBREVIATIONS → spoken forms (whole-word, tight list)
  t = t.replace(/\be\.g\.,?\s/gi, 'for example, ');
  t = t.replace(/\bi\.e\.,?\s/gi, 'that is, ');
  t = t.replace(/\betc\.(?=\s|$)/gi, 'et cetera.');
  t = t.replace(/\betc\.(?=[,!?)])/gi, 'et cetera');
  t = t.replace(/\bvs\.?\s(?=[a-zA-Z])/gi, 'versus ');
  t = t.replace(/\bapprox\.\s/gi, 'approximately ');

  // tidy any doubled spaces the expansions left
  return t.replace(/[ \t]{2,}/g, ' ');
}

// This is the endpoint LibreChat will hit -- it expects OpenAI's /v1/audio/speech path
// ── Brand/name pronunciation normalization (AUDIO ONLY) ──────────────────────
// Kade's name is pronounced "Kadie" (KAY-dee) Murdock. Left as-is, Inworld sounds
// the brand handles out wrong ("kah-day-mur-dock"). Rewrite the SPOKEN form to a
// phonetic spelling. This only touches the text sent to Inworld for synthesis —
// the visible chat text the user reads on screen is never modified.
// ── Pronunciation lexicon (Aug 6 2026, idea 12) ─────────────────────────────
// The old hardcoded brand rules stay exactly as they were (below), and a
// data-driven lexicon rides after them: whole-word, case-insensitive
// respellings applied at the synth funnel, so EVERY lane (web read-aloud,
// voice messages, conversation mode, the phone bridge) says family and
// Ozarks names right. AUDIO ONLY — visible chat text is never touched.
// Extend without a deploy: env TTS_LEXICON on this service, format
// "word=respelling;word2=respelling2" (semicolons or newlines between
// pairs; env entries override the defaults on the same key). Keys match
// whole words only, so "cabool" can never fire inside another word.
const PRONUNCIATION_LEXICON_DEFAULTS = {
  // Family. Keighty is spoken "Katie" — same KAY sound the Kade brand rules
  // below already enforce for kade/kademurdock.
  "keighty": "Katie",
  // Ozarks and Missouri places TTS reliably mangles, respelled the way
  // locals say them. Deliberately conservative: only entries with one known
  // local reading. Kade corrects or adds by ear via TTS_LEXICON.
  "bois d'arc": "Bodark",
  "bois darc": "Bodark",
  "cabool": "Kabool",
  "hayti": "Haytie",
};
const PRONUNCIATION_LEXICON = (() => {
  const entries = new Map(Object.entries(PRONUNCIATION_LEXICON_DEFAULTS));
  for (const [k, v] of parseAssignments(process.env.TTS_LEXICON)) entries.set(k.toLowerCase(), v);
  const compiled = [];
  for (const [k, v] of entries) {
    if (!k || !v) continue;
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      compiled.push({ re: new RegExp(`\\b${escaped}\\b`, "gi"), to: v });
    } catch (e) {
      console.warn(`[TTS] lexicon entry skipped (bad pattern "${k}"): ${e.message}`);
    }
  }
  console.log(`[TTS] pronunciation lexicon loaded: ${compiled.length} entries`);
  return compiled;
})();

function fixPronunciations(text) {
  if (!text) return text;
  let out = text
    // Most specific first so stems don't get half-replaced.
    .replace(/kademurdock[-_ ]?ai/gi, "Kadie Murdock A.I.")
    .replace(/kademurdock/gi, "Kadie Murdock")   // also covers kademurdock.com, @kademurdock
    .replace(/kade[-_ ]?ai/gi, "Kadie A.I.")     // the Kade-AI platform brand
    .replace(/\bkade\b/gi, "Kadie")            // bare first name -> KAY-dee
    // Zadiana -> "zay-dee-ON-nuh" (Kade's spec, July 2 2026). Covers Zadiana,
    // possessives, and the Zadi nickname keeps its natural read (ZAY-dee).
    // Spelling is env-tunable (July 3 2026): Kade reported the name reading
    // flat ("Zad-ee-ana") on Voice 14 — audition WAVs went to her folder;
    // set TTS_ZADIANA_SPELLING on this service to apply the winner.
    .replace(/\bzadiana\b/gi, process.env.TTS_ZADIANA_SPELLING || "Zaydionna");
  for (const { re, to } of PRONUNCIATION_LEXICON) out = out.replace(re, to);
  return out;
}

// ── TTS-2 emotion/performance tags (LLM-authored, sentinel-wrapped) ──────────
// Kiana (and later other agents, on Kade's go-ahead) write performance
// directions wrapped in a private PUA sentinel so they NEVER show up in the
// visible chat bubble, the copy buffer, or Conversation Mode captions -- the
// LibreChat fork strips the sentinel at render time (kademurdock/LibreChat,
// branch kade), but the CANONICAL SAVED MESSAGE keeps it, which is what lets
// read-aloud, Conversation Mode, and the phone bridge all stay expressive
// (they all read the saved message, same as today). Right here, just before
// synth, we convert the sentinel back into the real square brackets TTS-2
// actually interprets (see docs.inworld.ai/tts/capabilities/steering).
// Distinct PUA pair from the reasoning-bubble marker (U+F001/U+F002, see
// stripThinkingBlock above) so the two schemes can never collide.
// PIVOT (June 30 2026, same session): live testing showed GLM-5.2 does NOT
// reliably reproduce an exact PUA codepoint pair across generations -- 4/4
// live tagged replies from Kiana either skipped the tag, used the wrong
// character, or used it asymmetrically. Switched to a plain-ASCII SYMMETRIC
// delimiter (same token both ends, like markdown **bold**), which models
// reproduce far more reliably. Still effectively invisible: nobody types
// "%%%" mid-sentence, and the fork strips it the same as before.
const STEERING_OPEN = "%%%";
const STEERING_CLOSE = "%%%";

// Inworld's fixed inline non-verbal vocabulary. These can appear anywhere,
// repeatedly, inline -- unlike a leading direction they are NOT subject to
// the "one instruction at the start of an utterance" rule, so they need no
// carry-forward treatment in applySteeringTags below.
/* Aug 24 2026 (Part 92.14) — the sound list moved to sounds.js and grew from
 * SIX to Inworld's real ~50. Everything outside the old six was being treated
 * as a DIRECTION and CARRIED FORWARD onto every following paragraph, so a
 * `%%%gasp%%%` was pinned to the front of the whole rest of the reply instead
 * of gasping once. See sounds.js for the receipts. */
const { isDirectionTag: soundsIsDirectionTag, isResetTag: soundsIsResetTag, liftInstruction } = require("./sounds");
/* Kill switch for the instruction-field lift. "0" restores the old behaviour
 * exactly: directions ride inside the text as [brackets]. */
const TTS_INSTRUCTION_FIELD = process.env.KADE_TTS_INSTRUCTION_FIELD !== "0";

// Convert sentinel-wrapped tags to real [bracket] steering for TTS-2, AND
// carry a leading "direction" (anything that isn't a fixed non-verbal, e.g.
// "[say playfully]" or "[speak through gritted teeth]") forward onto every
// paragraph that doesn't already open with its own tag. This matters because
// chunkText() below fires each paragraph-group at Inworld as its OWN
// separate request/utterance for parallel synthesis -- without this, a long
// multi-paragraph reply would only sound expressive on the first chunk, since
// Inworld only honors a leading direction once, at an utterance's start.
// Inline non-verbals need no such treatment; they stay exactly where written.
/* KADE Aug 8 2026 — VOCALIZE PHYSICAL DIRECTIONS (her live catch: the deep
 * payload showed [cracks knuckles] reaching Inworld — stage business no voice
 * can perform, and the likely culprit behind flat deliveries: hand the
 * synthesizer a body and it shrugs off the whole direction). The platform
 * note now teaches the ONE LAW upstream (a direction must be something a
 * VOICE can do); this is the last-line net for what still slips through.
 * Known physical idioms translate into the vocal color they imply; a tag
 * that is PURELY silent body language (nods, shrugs) drops entirely. Runs on
 * the tag TEXT before bracket conversion, both providers. */
const PHYSICAL_TO_VOCAL = [
  [/\bcracks?(?:ing)? (?:his |her |their )?knuckles\b/gi, 'limbering up, ready for business'],
  [/\bleans? (?:in|forward|closer)\b/gi, 'dropping closer, conspiratorial'],
  [/\bleans? back\b/gi, 'settling back, relaxed and unhurried'],
  [/\bshifts? (?:his |her |their )?weight\b/gi, 'a beat of restless energy in the voice'],
  [/\brubs? (?:his |her |their )?hands\b/gi, 'gleeful anticipation'],
  [/\bsmirk(?:s|ing)?\b/gi, 'you can hear the smirk'],
  [/\bgrin(?:s|ning)?\b/gi, 'grinning audibly'],
  [/\bsmil(?:es?|ing)\b/gi, 'warmth you can hear'],
  [/\brolls? (?:his |her |their )?eyes\b/gi, 'dry, audibly unimpressed'],
  [/\braises? (?:an |her |his |their )?eyebrows?\b/gi, 'skeptical lilt'],
  [/\bwink(?:s|ing)?\b/gi, 'playful, in on the joke'],
  [/\btilts? (?:his |her |their )?head\b/gi, 'curious lilt'],
  [/\bcrosses? (?:his |her |their )?arms\b/gi, 'firm, planted'],
  [/\bshak(?:es?|ing) (?:his |her |their )?head\b/gi, 'disbelief in the voice'],
];
const PURELY_SILENT = /^(?:nods?(?:ding)?|shrugs?(?:ging)?|blinks?|waves?|points?(?:ing)?|paces?(?:ing)?|stretch(?:es)?|looks? (?:around|away|up|down)|glances? \w+)$/i;
function vocalizeDirection(tagText) {
  let t = String(tagText).trim();
  if (PURELY_SILENT.test(t)) return null; /* silent body language: drop the tag */
  for (const [re, repl] of PHYSICAL_TO_VOCAL) {
    t = t.replace(re, repl);
  }
  return t;
}

/* ⭐⭐⭐ LOOSE-DIRECTION RESCUE (Aug 19 2026 — Amber's report: "it's reading
 * 'a beat' as the words").
 *
 * THE BUG, reproduced end-to-end before writing a line of this: the same
 * sentence synthesized on her voice four ways, then transcribed back off the
 * audio with Deepgram —
 *
 *   %%%a beat%%%  -> "She said it. Then she left the room."        CLEAN
 *   (a beat)      -> "She said it A BEAT. Then she left the room." SPOKEN
 *   *a beat*      -> "She said it A BEAT. ..."                     SPOKEN
 *   (softly)      -> "She said it, SOFTLY. ..."                    SPOKEN
 *
 * The %%% path was always right. The other two never had a guard at all:
 * `stripSpeechMarkdown` strips asterisk MARKERS and keeps the text (correct
 * for markdown emphasis, ruinous for stage directions, which share the
 * syntax), and NOTHING in the whole prep chain has ever touched parentheses.
 *
 * WHY IT SURFACED NOW: the fleet moved to glm-5.2 on Aug 18, and parenthetical
 * stage directions are a deep prose-fiction habit. The platform note already
 * tells every character to use three percent signs and names "a beat" as the
 * Second Law's own bad example — but it ALSO promises "a tag is NEVER read
 * aloud, so reaching for one is never a risk." That promise was false for two
 * common forms, which punished a character for following its instincts. This
 * makes the promise true.
 *
 * DELIBERATELY VOCABULARY-GATED, HER CALL: only spans that MATCH a known
 * direction are touched. "I called her (twice) and she never picked up" and a
 * genuine *emphasised* word are left completely alone — a false positive here
 * eats real speech, which is far worse than the bug being fixed.
 *
 * TIMING DIRECTIONS ARE DROPPED, NOT CONVERTED, per the note's Second Law:
 * a direction that describes WAITING gets paid off as literal silence
 * sprinkled through the paragraph. Punctuation already does the timing. */
const LOOSE_TIMING = /^(?:a\s+)?(?:beat|pause|long pause|short pause|beat of silence|silence)(?:\s*[,.]?\s*(?:then|before|and)\b[\s\S]{0,40})?$/i;
/* Aug 20 2026 (Kade: TTS spoke "slightly amused" — her exact phrase was in
 * NO vocabulary here, so a parenthetical or asterisk form of it was spoken as
 * words DETERMINISTICALLY, every time, on every provider). Two widenings,
 * both still vocabulary-gated per her standing call:
 * (1) intensifiers grew the natural family (a little / half / mildly / kind
 *     of …); (2) a set of emotion ADJECTIVES with essentially no standalone-
 *     parenthetical use outside stage direction (amused, wry, smug, sheepish
 *     …). Deliberately EXCLUDED: bare adjectives with real non-direction
 *     parenthetical collisions — warm, dry, soft, quiet, flat, cold, low —
 *     a recipe's "(warm)" must never become a voice direction. And (3) short
 *     combos: up to three matching items joined by commas/and/but, so
 *     "(slightly amused, a little smug)" rescues whole or not at all. */
const LOOSE_INTENSIFIER = "(?:(?:very|so|a bit|a little|slightly|almost|half|mildly|faintly|kind of|kinda|sort of)\\s+)?";
const LOOSE_DELIVERY_WORD = "(?:" +
  "softly|quietly|gently|firmly|dryly|flatly|warmly|coldly|sharply|slowly|quickly|carefully|" +
  "hesitantly|nervously|cheerfully|sadly|bitterly|wryly|tenderly|sternly|playfully|teasing(?:ly)?|" +
  "deadpan|whisper(?:s|ing)?|mutter(?:s|ing)?|sigh(?:s|ing)?|laugh(?:s|ing)?|chuckl(?:es|ing)|" +
  "giggl(?:es|ing)|grin(?:s|ning)?|smil(?:es|ing)|smirk(?:s|ing)?|scoff(?:s|ing)?|snort(?:s|ing)?|" +
  "groan(?:s|ing)?|gasp(?:s|ing)?|breath(?:es|ing)|exhal(?:es|ing)|inhal(?:es|ing)|" +
  "amused|bemused|wry|sarcastic|serious|sincere|fond|smug|sheepish|apologetic|" +
  "exasperated|annoyed|thoughtful|hesitant|wistful|somber|sly|flirty|conspiratorial" +
  ")";
const LOOSE_ITEM = LOOSE_INTENSIFIER + LOOSE_DELIVERY_WORD;
const LOOSE_DELIVERY = new RegExp(
  "^" + LOOSE_ITEM + "(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+but\\s+)" + LOOSE_ITEM + "){0,2}$", "i");

function looksLikeDirection(raw) {
  const t = String(raw || "").trim();
  if (!t || t.length > 60) return false;
  if (LOOSE_TIMING.test(t)) return "timing";
  if (LOOSE_DELIVERY.test(t)) return "delivery";
  if (PURELY_SILENT.test(t)) return "silent";
  for (const [re] of PHYSICAL_TO_VOCAL) {
    re.lastIndex = 0;              // these carry /g, so test() is stateful
    if (re.test(t)) return "physical";
  }
  return false;
}

function rescueLooseDirections(text) {
  if (!text) return text;
  const rescue = (inner) => {
    const kind = looksLikeDirection(inner);
    if (!kind) return null;                       // not a direction: leave it exactly as written
    if (kind === "timing") return "";             // Second Law: the clock is never a direction
    return `${STEERING_OPEN}${String(inner).trim()}${STEERING_CLOSE}`;
  };
  let out = text.replace(/\(([^()\n]{1,60})\)/g, (whole, inner) => {
    const r = rescue(inner);
    return r === null ? whole : r;
  });
  // Same shape stripSpeechMarkdown uses for single-asterisk italics, so the two
  // agree on what an asterisk span IS. Must run BEFORE it, or the markers are
  // already gone and the direction is indistinguishable from ordinary words.
  out = out.replace(/(^|[^*\w])\*([^*\n]{1,60})\*(?!\*)/g, (whole, pre, inner) => {
    const r = rescue(inner);
    return r === null ? whole : pre + r;
  });
  return out;
}

/* ── MARKDOWN EMPHASIS -> SPOKEN EMPHASIS (Aug 20 2026) ──────────────────────
 * Kade, reading a Kiana reply: "I saw some word with emphasis having stars
 * around it, and I wonder if she meant to do that or if that was supposed to
 * make it look a certain way visually. If we're talking speech, I'd say there
 * should probably be an emphasis tag before that word."
 *
 * She is right, and the intent was being thrown away. Measured across 1,641
 * stored assistant messages: 10.1% carry `*emphasis*` or `**bold**`, and
 * there are 178 single-asterisk spans. Until now every one of them died here:
 * `rescueLooseDirections` deliberately leaves a genuine *emphasised* word
 * alone (correct — a false positive there eats real speech), and then
 * `stripSpeechMarkdown` removes the markers and keeps the bare word. The
 * model asked for stress; the listener got a flat word. On a screen the
 * italics would at least render. Kade is blind. Nothing rendered.
 *
 * THE FIX IS A ROUTE, NOT A NEW MECHANISM. This platform already HAS a
 * working emphasis path, and it is CAPITALIZATION:
 *   • Inworld (docs.inworld.ai → Steering → Emphasis, re-read this date):
 *     "Capitalize letters within your input text to draw attention to
 *     specific words or syllables. Fully capitalizing a word stresses the
 *     entire word, while capitalizing individual letters within a word
 *     emphasizes a specific syllable." Their own example: "I told you NOT to
 *     open that door."
 *   • Fish: `fishEmphasisFromCaps` (Aug 6) already turns a mid-text ALL-CAPS
 *     word into fish's documented `[emphasis] WORD`.
 * So converting `*word*` -> `WORD` lands it in machinery that is already
 * proven on BOTH providers. No new tag vocabulary, no provider fork here.
 *
 * ⚠️ NOTE THE TWO DIFFERENT PLACES CAPITALS MATTER, because they look
 * contradictory and are not: Inworld's best practices say "avoid capital
 * letters and punctuation in YOUR INSTRUCTIONS" — that is about the text
 * INSIDE a [steering tag]. Capitals in the SPOKEN TEXT are their documented
 * emphasis mechanism. Different place, opposite advice, both correct.
 *
 * SINGLE WORDS ONLY, and the corpus is why. Of 178 spans: 74% are one word
 * (`can`, `you`, `felt`, `real`, `opposite`) — the clean case. The rest are
 * not emphasis at all: `*Script:*` appears THIRTY times as a label, one span
 * is a malformed `*%%cough%%*` steering tag, and multi-word spans like
 * `*while you were on them*` or `*the 7th floor*` would become shouting.
 * Letters-only (plus apostrophe/hyphen) rejects the label and the broken tag
 * for free. House rule from the normalization layer applies: when in doubt a
 * shape is LEFT ALONE, because a wrong read is worse to the ear than a
 * missed nicety.
 *
 * Underscores (`_word_`) are deliberately NOT handled: identifiers like
 * kade_ai_bridge would match, and that trade is bad.
 *
 * ORDER IS LOAD-BEARING: must run AFTER rescueLooseDirections (so `*sigh*`
 * has already become a %%% tag rather than the word SIGH) and BEFORE
 * stripSpeechMarkdown (which deletes the markers). AUDIO-ONLY, like every
 * other prep-chain step — the visible chat text is never touched.
 * Kill switch: KADE_TTS_MD_EMPHASIS=0. */
const MD_EMPHASIS_ON = process.env.KADE_TTS_MD_EMPHASIS !== "0";

function emphasisFromMarkdown(text) {
  if (!text || !MD_EMPHASIS_ON || text.indexOf("*") === -1) return text;
  return text.replace(
    /(^|[^*\w])\*([A-Za-z][A-Za-z'\u2019-]{1,13})\*(?!\*)/g,
    (whole, pre, word) => {
      if (word === word.toUpperCase()) return whole;   // already stressed
      return pre + word.toUpperCase();
    }
  );
}

/* ⭐ TAG-TEXT SANITIZER (Aug 20 2026 — Kade: "it read one of the tags as a
 * word, slightly amused or something like that," and the tag never showed in
 * her transcript). The live receipt (00:25Z, Voice 14): this converter handed
 * Inworld `[warm, a little amused]` VERBATIM — comma-spliced, exactly the
 * shape Inworld's best practices warn against ("avoid capital letters and
 * punctuation in your instructions", docs re-read Aug 20). The v130 persona
 * fix teaches models to WRITE clean tags going forward, but old-shape tags
 * still arrive — from 220+ untouched personas, from relapse, from
 * PHYSICAL_TO_VOCAL's own comma-carrying replacements ("dry, audibly
 * unimpressed"). 18 direct synth probes could not force the read-aloud on
 * demand — the leak is stochastic (July 27 "tags still spoken sometimes",
 * Aug 19 "a beat") — so the fix is to never ship the malformed shape at all:
 * every direction is made doc-conformant at this ONE chokepoint, whoever
 * wrote it, however old. Lowercase, commas become "and" joins, terminal
 * punctuation dropped. Apostrophes are KEPT (contractions are normal inside
 * a direction). Non-verbal SOUNDS (sounds.js) are untouched by
 * construction, so fish's dialect mapping still matches. Kill switch:
 * KADE_TTS_TAG_SANITIZE=0. */
const TAG_SANITIZE_ON = process.env.KADE_TTS_TAG_SANITIZE !== "0";
function sanitizeDirectionText(t) {
  if (t == null || !TAG_SANITIZE_ON) return t;
  let s = String(t).trim().toLowerCase();
  s = s.replace(/\s*,\s*(?:and\s+)?/g, " and ");
  s = s.replace(/[.!?;:"()\u201c\u201d\u2014]+/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

const STEER_CARRY_MAX = parseInt(process.env.TTS_STEER_CARRY || "2", 10);

function applySteeringTags(text) {
  if (!text || text.indexOf("%%") === -1) return text;
  // Tag-typo tolerance (July 2 2026, seen live from Kiana): models sometimes
  // emit "%%sigh%%" or "%%%sigh%%" instead of the canonical "%%%sigh%%%".
  // Normalize any 2-4-percent delimited, short, direction-looking span to the
  // canonical form BEFORE parsing, so a typo'd tag still steers the voice
  // instead of being read aloud as "percent percent sigh".
  // July 27 2026 (Kade: tags still spoken "sometimes"): the old class here
  // ([a-zA-Z ’',!-]) refused digits, periods, slashes, parens, dashes -- so
  // "%%80s radio DJ%%" or "%%dead serious.%%" fell through BOTH passes and
  // synthesized as "percent percent ...". Widened: 2-5 percents either side,
  // content = letter-or-digit-led (must contain a letter somewhere, so a
  // bare "%%50%%" number never gets eaten), anything but % or newline,
  // still length-capped.
  // Aug 21 2026 (the length-cap sweep): v130+ personas teach LAYERED
  // directions that outgrew the July-27 cap -- a TYPO'D long tag fell through
  // this normalizer, and the residual %-sweep then stripped its delimiters
  // and SPOKE THE WORDS: the exact "slightly amused" disease, one typo away.
  // Widened 79/78 -> 160.
  text = text.replace(/%{2,5}((?=[^%\n]{0,160}[a-zA-Z])[a-zA-Z0-9][^%\n]{0,159}?)%{2,5}/g, "%%%$1%%%");
  // July 27 2026: no canonical tag even after normalizing means whatever %%
  // runs remain are mangled beyond steering (unclosed opener, stray runs) --
  // never hand them to the synth to be read as "percent percent". Single "%"
  // (real percentages) is untouched here and below.
  if (text.indexOf(STEERING_OPEN) === -1) return text.replace(/%{2,}/g, "");

  const tagRe = new RegExp(`${STEERING_OPEN}([\\s\\S]*?)${STEERING_CLOSE}`, "g");
  // Pass 1: sentinel -> real brackets, everywhere in the text.
  const converted = text.replace(tagRe, (_, raw) => {
    /* Aug 8 2026: physical stage business becomes vocal color or vanishes —
     * see vocalizeDirection above. A dropped tag leaves no bracket at all. */
    const vocal = sanitizeDirectionText(vocalizeDirection(raw));
    return vocal && vocal.length > 0 ? `[${vocal}]` : '';
  });

  // Pass 2: carry the most recent leading direction across paragraph breaks.
  // chunkText() groups whole paragraphs into a chunk and only sub-splits a
  // single paragraph that alone exceeds MAX_CHUNK_LEN, so aligning to
  // paragraph boundaries here means virtually every resulting TTS chunk
  // opens with a direction. (The rare case of one oversized paragraph with
  // no blank line getting sentence-split mid-paragraph is a known, narrow
  // limitation -- only its first sentence-group carries the tag.)
  const bracketAtStart = /^\s*\[([^\]]+)\]/;
  const parts = converted.split(/(\n\s*\n+)/); // odd indices are the blank-line separators themselves
  let active = null;
  let carried = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 || !parts[i].trim()) continue; // separator or blank -- leave untouched
    const opens = parts[i].match(bracketAtStart);
    if (opens) {
      /* ⭐ AUG 25 2026 — [reset] ENDS THE CARRY, WHICH IS ITS ENTIRE JOB.
       * Kade: "it read the whole voice clip in a really fast, rushed tone and
       * pace... it seemed to make it follow through the whole message." The
       * receipt was a real reply of Kiana's opening
       * `%%%quick and animated still a little spooked by it%%%` — one authored
       * tag, six paragraphs, and the carry-forward paid "quick" onto the next
       * two. Without a way to say STOP, the only tool an author had was writing
       * another direction, so a passage that should simply return to her own
       * register could not.
       * Falling through to the branch below would set active = "reset" and then
       * STAMP `[reset]` onto the following paragraphs — the precise opposite of
       * what the author asked for. */
      if (soundsIsResetTag(opens[1])) {
        active = null;
        carried = 0;
        continue;
      }
      if (soundsIsDirectionTag(opens[1])) {
        active = opens[1].trim();
        carried = 0;
        /* ⚠️ AUG 18 2026 — THE DOUBLE-TAG WART, KILLED AT THE SOURCE.
         * Characters routinely write a direction ALONE on its own line:
         *
         *     %%%a beat, then the landing%%%
         *
         *     Ailes himself got forced out...
         *
         * That converts to a paragraph that is NOTHING BUT `[direction]`, and
         * then the carry-forward below re-states the very same direction on
         * the paragraph after it -- so the text handed to the provider reads
         * `[a beat, then the landing]\n\n[a beat, then the landing] Ailes...`.
         * Inworld survived it by accident (shapeInworldSteering drops an
         * identical carried repeat inside a chunk), but the FISH lane has no
         * such dedupe, and the same message measured 31 bracket tags on fish
         * against 9 on Inworld. Fish reads a doubled cue as two cues.
         * A direction-only paragraph is a stage note, not a line to perform,
         * and the next paragraph is about to carry it anyway -- so drop it,
         * for every lane at once. Only when something actually follows: a
         * trailing direction with nothing after it is left alone for the
         * existing words-free filter to handle. */
        let nextIdx = -1;
        for (let j = i + 1; j < parts.length; j++) {
          if (j % 2 === 1) continue;
          if (parts[j] && parts[j].trim()) { nextIdx = j; break; }
        }
        if (nextIdx !== -1 && !parts[i].slice(opens[0].length).trim()) {
          parts[i] = "";
          if (i + 1 < parts.length && i % 2 === 0) parts[i + 1] = ""; // its trailing blank line too
        }
      }
      continue; // paragraph already opens with its own tag -- don't double up
    }
    // ⚠️ AUG 18 2026 — THE CARRY-FORWARD IS NOW CAPPED. It used to run to the
    // END OF THE MESSAGE, and that is the second half of her "random pauses"
    // complaint. Receipts from her Fox conversation: 3 authored %%% tags
    // became 12 applied [tags] (msg 5), and 6 became 53 (msg 3). One
    // "%%%a beat, then the landing%%%" she wrote for a single closing moment
    // was being re-stamped onto every paragraph after it, and Inworld pays a
    // mood direction off in PACING -- measured on Voice 578, the same
    // sentence ran 14.51s with two natural pauses untagged vs 15.98s with
    // three (375/825/585ms) once that tag led it. A direction should color
    // the thought it was written for and the next beat or two, not haunt the
    // rest of the reply. TTS_STEER_CARRY=99 restores the old behavior;
    // 0 disables carry-forward entirely (chunks past the first read flat --
    // that is the bug this mechanism was built to fix, so don't).
    if (active && carried >= STEER_CARRY_MAX) active = null;
    if (active) { parts[i] = `[${active}] ${parts[i]}`; carried++; }
  }
  // July 27 2026: same residual sweep as the early return -- any %%-run that
  // survived conversion is a broken tag (asymmetric closer, 6+ percents),
  // and a swallowed delimiter always beats a spoken one.
  return parts.join("").replace(/%{2,}/g, "");
}


// ── PROVIDER-AWARE STEERING SHAPING (Aug 3 2026 — Kade: fish voices come out
// "flat and non-emotional for certain stretches"; her call: fix fish, and
// bring Inworld along ONLY if it doesn't hurt) ────────────────────────────────
// The two providers want steering DELIVERED differently (both docs re-read
// this date):
//  • Fish s2.1 (docs.fish.audio → Emotion Control): cues are SENTENCE-level —
//    "Don't place sentence-level emotion cues far from the sentence they
//    control." One leading [direction] on a 3-5 sentence paragraph steers the
//    first sentence, then the clone decays to its source-sample baseline =
//    exactly her "flat for stretches." Fix: re-seed the paragraph's direction
//    at the start of every sentence (fish's own "emotion transitions" pattern;
//    markers are free per their docs, byte cost is noise).
//  • Inworld TTS-2 (docs.inworld.ai → Steering): ⚠️ THE DOCS CHANGED, AND THE
//    QUOTE THAT USED TO SIT HERE IS NOW WRONG. As of the Aug 28 2026 re-read,
//    mid-text tags are the DOCUMENTED pattern: "A [tag] applies from where
//    you write it until you change it… Add a tag mid-text when the
//    performance genuinely shifts." Multiple inline tags per request are
//    fully supported ("[shouting] Go! [whisper] Quietly now."), [reset] ends
//    a passage, and CAPITALIZED words are the documented emphasis mechanism.
//    (The Aug-26 stale-comment lesson: a doc quote is a snapshot, and this
//    one cost nothing only because somebody re-read the source.)
//    shapeInworldSteering's request-splitting below therefore fixes a
//    problem the CURRENT docs say no longer exists; it still produces
//    correct audio and stays until a measured pass says the single-request
//    form sounds as good (TTS_INWORLD_SPLIT=0 would be that experiment's
//    switch if built). Per-sentence seeding would still hurt here, and the
//    dedupe below is still right: the paragraph carry-forward can leave the
//    SAME direction 2+ times inside one multi-paragraph chunk — keep the
//    first, drop identical repeats, and if a genuinely NEW direction opens a
//    later paragraph, SPLIT the chunk there so each request opens with
//    exactly one instruction. (The audition line's mid-paragraph beats are
//    untouched — this only looks at paragraph-leading tags.)
const LEADING_TAG_RE = /^\s*\[([^\]]+)\]\s*/;

function isDirectionTag(inner) {
  return soundsIsDirectionTag(inner);
}

// Fish's documented audio-effect vocabulary uses -ing forms where Inworld's
// fixed six use bare verbs. S2 is open-vocab so bare forms usually land, but
// the documented spelling is the sure thing; only the three that differ are
// mapped ([clear throat] matches fish verbatim, [breathe]/[cough] have no
// documented fish twin and ride the open vocabulary).
const FISH_NONVERBAL_DIALECT = { laugh: "laughing", sigh: "sighing", yawn: "yawning", breathe: "break" };
// Aug 6 2026 (her fish-docs pointer: "they say emphasis on some words in the
// fish api sample material"): fish's canonical stress = "[emphasis]" placed
// RIGHT BEFORE the word — our house idiom is CAPITALIZING the word (native to
// Inworld). Translate for the fish lane only: a mid-text ALL-CAPS word (3+
// letters, not a common acronym) gains [emphasis] in front; the word itself
// stays as written. Docs receipt: "This is [emphasis] really important."
// Stoplist = acronyms/initialisms only. Deliberately NOT stopping words like
// NOT/YOU/ALL — a model that capitalizes those MEANT the stress (the fish
// docs' own example is "I told you NOT to open that door").
const FISH_EMPHASIS_STOPLIST = new Set(["TTS","URL","USA","ASAP","LOL","OMG","FYI","DIY","CEO","GPS","FAQ","API","USB","GPT","LLM","FBI","NASA","DNA","PDF","HTML","WIFI"]);
function fishEmphasisFromCaps(text) {
  return text.replace(/(^|[\s"'(—-])([A-Z]{3,12})(?=$|[\s.,!?;:)"'—-])/g, (m, pre, word) => {
    if (FISH_EMPHASIS_STOPLIST.has(word)) return m;
    return `${pre}[emphasis] ${word}`;
  });
}

// Short interjections inherit the surrounding mood on their own; a tag longer
// than its sentence is noise (fish: "don't overuse emotion tags in short text").
const FISH_SEED_MIN_SENTENCE_LEN = 30;

// Aug 18 2026: last line of defence for the fish lane. applySteeringTags now
// drops direction-only paragraphs at the source, but fish reads a doubled cue
// as two cues, so any adjacent identical [tag][tag] pair -- however it got
// here -- collapses to one before synthesis.
function collapseAdjacentTags(text) {
  if (!text || text.indexOf("[") === -1) return text;
  let out = text, prev;
  do {
    prev = out;
    out = out.replace(/\[([^\]]+)\](\s*)\[([^\]]+)\]/g, (m, a, gap, b) =>
      a.trim().toLowerCase() === b.trim().toLowerCase() ? `[${a}]${gap.includes("\n") ? "\n\n" : " "}` : m
    );
  } while (out !== prev);
  return out.replace(/[ \t]{2,}/g, " ");
}

function seedFishSteering(chunk) {
  if (!chunk) return chunk;
  /* KADE Aug 29 2026 — [reset] IS INWORLD'S WORD, AND FISH WAS BEING MADE TO
   * SAY IT ON REPEAT. isDirectionTag('reset') is true (reset is deliberately
   * not a canonical sound), so the per-sentence seeder below treated a
   * closing [reset] as a direction and stamped it onto EVERY sentence of the
   * paragraph — "[reset] Anyway. [reset] Text me…" — a cue fish has no
   * concept of, repeated. On this lane reset's ENTIRE meaning is "no seed":
   * strip the tag and the paragraph rides the clone's own baseline, which is
   * exactly what the author asked for. (Inworld's lane keeps [reset] inline —
   * there it is documented and load-bearing.) */
  chunk = chunk.replace(/\[([^\]]+)\]\s*/g, (m, inner) => (soundsIsResetTag(inner) ? "" : m));
  chunk = collapseAdjacentTags(chunk);
  // CAPS->[emphasis] runs even when no [cues] exist — stressed words deserve
  // stress regardless of whether the reply carried steering tags.
  chunk = fishEmphasisFromCaps(chunk);
  if (chunk.indexOf("[") === -1) return chunk;
  let text = chunk.replace(/\[(laugh|sigh|yawn|breathe)\]/gi, (_, w) => `[${FISH_NONVERBAL_DIALECT[w.toLowerCase()]}]`);
  const parts = text.split(/(\n\s*\n+)/);
  for (let i = 0; i < parts.length; i += 2) {
    const para = parts[i];
    if (!para || !para.trim()) continue;
    const m = para.match(LEADING_TAG_RE);
    if (!m || !isDirectionTag(m[1])) continue;
    const dir = m[1].trim();
    const sentences = splitSentences(para.slice(m[0].length)).filter(Boolean);
    if (sentences.length <= 1) continue;
    const seeded = sentences.map((s, idx) => {
      if (idx === 0) return s;
      if (s.startsWith("[")) return s; // its own tag (direction or non-verbal) — leave it
      if (s.length < FISH_SEED_MIN_SENTENCE_LEN) return s;
      return `[${dir}] ${s}`;
    });
    parts[i] = `[${dir}] ` + seeded.join(" ");
  }
  return parts.join("");
}

function shapeInworldSteering(chunk) {
  if (!chunk || chunk.indexOf("[") === -1) return [chunk];
  const parts = chunk.split(/(\n\s*\n+)/);
  const out = [];
  let cur = "";
  let curDir = null;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { cur += parts[i]; continue; } // paragraph separator rides along
    const para = parts[i];
    if (!para || !para.trim()) { cur += para; continue; }
    const m = para.match(LEADING_TAG_RE);
    const dir = m && isDirectionTag(m[1]) ? m[1].trim() : null;
    if (dir == null) { cur += para; continue; } // untagged/non-verbal-led paragraph — ride along
    if (!cur.trim()) { curDir = dir; cur += para; continue; } // opens the request
    if (dir === curDir) { cur += para.slice(m[0].length); continue; } // identical carried repeat — drop the tag
    out.push(cur.trimEnd()); // genuinely new direction — new request
    cur = para;
    curDir = dir;
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [chunk];
}

// ── CORS for browser-side voice conversation (F2 patch) ──────────────────────
// Allows kademurdock.com PWA to call /v1/audio/speech directly from the browser
// (the web/Skype-style voice mode). Restricted to our origin — not open CORS.
app.use("/v1/audio/speech", (req, res, next) => {
  const origin = req.headers.origin || '';
  if (origin === 'https://kademurdock.com' || origin === 'http://localhost:3080') {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


// ── Loudness normalization (July 1 2026, Kade's ask: equal volume across voices) ──
// Custom cloned voices synth at wildly different levels (quiet source sample =
// quiet voice, hot sample = loud voice). EVERY synth path funnels through
// /v1/audio/speech, so normalizing here fixes chat read-aloud, the in-app
// previews, the /voices library, and the phone -- one place, all surfaces.
//
// Approach: measure speech-gated RMS (30ms windows; windows quieter than 10%
// of the loudest window are pauses/room tone and get ignored), then apply ONE
// flat gain that moves the voice's typical speaking level to the target.
// The measured level is smoothed PER VOICE (EMA) so on the phone path -- where
// every sentence is its own request -- a deliberately whispered sentence isn't
// individually boosted to shouting volume. The voice keeps its dynamics; the
// VOICE as a whole lands at the same loudness as every other voice.
// Peak-limited so a boost can never clip. Kill switch: TTS_NORM=0.
const TTS_NORM_ENABLED = process.env.TTS_NORM !== "0";
const TTS_NORM_TARGET_DB = parseFloat(process.env.TTS_NORM_TARGET_DB || "-13.5"); // speech RMS target, dBFS. July 19 2026 (Kade: "a little louder" through the website, not iOS volume) -- checked Railway first and found a stray env var override already sitting at -18.5 (from the July 16 tuning session) that the old "-20" default here never matched live; moved the code default to -15 (~3.5dB over what was actually live) and updated the Railway var to match, so this default is genuinely the live source of truth again. July 23 2026: -15 -> -16.5 (Kade OK'd "turning down the volume a little" to stop the buzzy clipping on hot voices; Railway var updated to match the same day -- keep them in sync). Aug 5 2026: -16.5 -> -15 (Kade: "turn the voices up a little... don't want them to clip" vs VoiceOver's own volume) -- the July-23 buzz was the 2dB limiter headroom letting brief hard-clips through on hot voices, so this raise ships WITH the headroom drop below (2 -> 0.5dB): quiet voices gain the full ~1.5dB, hot voices hit a CLEAN peak ceiling instead of the buzz. Railway var updated same hour -- keep in sync. Aug 6: -15 -> -13.5 (her "still too quiet" after the knee-budget shipped -- the budget now owns the buzz line, so the target can chase room-carry volume; Railway var synced same minute).
const TTS_NORM_MAX_BOOST_DB = parseFloat(process.env.TTS_NORM_MAX_BOOST_DB || "18");
const TTS_NORM_MAX_CUT_DB = parseFloat(process.env.TTS_NORM_MAX_CUT_DB || "14");
// July 16 2026 (Kade's web call, "starts loud then gets quieter" + distortion):
// SNAP_DB = level-EMA divergence guard -- a clip measuring this far off the
// running estimate means the estimate is stale evidence (different delivery/
// style/session), so trust the clip and restart smoothing from it. Normal
// clip-to-clip wobble within one voice+style is ~±3 dB; 6 is comfortably past.
const TTS_NORM_SNAP_DB = parseFloat(process.env.TTS_NORM_SNAP_DB || "6");
// Soft-knee output limiter (replaces the bare per-sample hard clamp): fully
// transparent below KNEE, saturates smoothly toward -- never past -- full
// scale above it (tanh < 1, so clipping is mathematically impossible). Knee
// starts at 26000 (~2 dB below full scale): wide enough that a transient up
// to ~3-4 dB over stays rounded and varied instead of plateauing; the cost is
// at most ~0.1 dB of compression on the rare clean peaks in the 26-30k zone.
const TTS_NORM_KNEE = parseInt(process.env.TTS_NORM_KNEE || "26000", 10);
const TTS_NORM_KNEE_RANGE = 32767 - TTS_NORM_KNEE;
// Limiter headroom (July 19 2026, Kade: "it dips down still in a weird way" +
// "some are a little more soft spoken and others are loud af"). Diagnosed off
// 37 real voices in production logs, not theory: the peak cap below was so
// conservative that 30 of 37 voices NEVER reached the loudness target -- they
// were peak-limited, not target-limited -- landing anywhere from -22.8 to
// -15.0 dBFS. That 7.8 dB spread IS the "dips down" and the soft/loud
// inconsistency. Speech runs a 15-17 dB crest factor, so a flat gain big
// enough to hit the target always wants peaks past full scale; capping gain
// at the raw peak means the target is simply unreachable for most voices.
// Meanwhile the soft-knee limiter built for exactly this job was doing
// essentially nothing (measured 0.01-0.05% of samples). This lets gain exceed
// the raw peak cap by a bounded amount and lets the knee absorb it -- which is
// what a limiter is FOR. Verified on real synthesized clips: +4 dB headroom
// yields +3.8 dB real loudness while touching only 0.35-0.57% of samples, and
// tanh still makes clipping mathematically impossible. Projection across all
// 37 voices: spread 7.8 -> 3.8 dB, voices at target 4/37 -> 32/37, and voices
// ALREADY at target are unchanged (their own wanted-gain still binds them), so
// this only lifts the ones falling short. Set to 0 to restore the old
// peak-capped behavior exactly.
// July 23 2026 (Kade: "some of the voices are clipping... that buzzy static
// sound when things are too bassy or too trebly"): 4 dB of knee drive was too
// hot for the peakier fish clones -- sustained stretches lived in the tanh
// saturation zone, which is audible as fuzz/buzz even though it never hard-
// clips. Halved to 2 dB: distortion drops superlinearly with drive; the cost
// is the very quietest crest-heavy voices landing ~2 dB shy of target, which
// beats them buzzing. Paired with the target drop below (-15 -> -16.5).
const TTS_NORM_LIMIT_HEADROOM_DB = parseFloat(process.env.TTS_NORM_LIMIT_HEADROOM_DB || "2"); // Aug 5 2026: 2 -> 0.5 (see TTS_NORM_TARGET_DB note -- the old 2dB overshoot allowance over the smoothed peak was the buzzy-clipping source; 0.5dB keeps limiting clean while the hard per-sample clamp stays as the absolute net).
const TTS_NORM_LIMIT_HEADROOM = Math.pow(10, TTS_NORM_LIMIT_HEADROOM_DB / 20);
// July 23 2026: absolute per-clip true-peak ceiling. The smoothed-peak cap
// above deliberately tolerates THIS clip's raw peak exceeding the running
// estimate (that's what stopped one transient from ducking a whole clip, July
// 16) -- but when a clip lands FAR above the estimate (new emphatic delivery,
// alpha as low as 0.1), the overshoot all lands in the tanh knee as heavy
// saturation = Kade's "buzzy static". This caps how far THIS clip's own true
// peak may be driven past full scale no matter what the estimate says. It
// only binds when true peak > estimate by more than (overdrive - headroom) dB
// -- normal wobble never touches it, so the anti-ducking behavior survives.
const TTS_NORM_MAX_OVERDRIVE_DB = parseFloat(process.env.TTS_NORM_MAX_OVERDRIVE_DB || "4");
const TTS_NORM_MAX_OVERDRIVE = Math.pow(10, TTS_NORM_MAX_OVERDRIVE_DB / 20);

// Aug 6 2026 (Kade: "voices sometimes pop when the levels are balancing out...
// I still like the voices to be loud, so they can carry conversationally in a
// room"): two additions. (1) GAIN RAMP — consecutive clips for a voice used to
// STEP between gains while the EMA converged (her pop); now each clip GLIDES
// from the voice's previous applied gain to its own over the first
// TTS_NORM_RAMP_MS. (2) KNEE BUDGET — gain chases the RMS target but backs off
// whenever more than TTS_NORM_KNEE_BUDGET of samples would hit the tanh
// saturator: that engagement fraction IS the audible line between loud and
// buzzy (the July-23 buzz was heavy knee engagement, not the knee itself).
// With the budget owning quality, the smoothed-peak headroom loosens back to
// 2 dB so peaky voices stop getting ducked below the room-carrying target.
const TTS_NORM_RAMP_MS = parseFloat(process.env.TTS_NORM_RAMP_MS || "90");
const TTS_NORM_KNEE_BUDGET = parseFloat(process.env.TTS_NORM_KNEE_BUDGET || "0.015");
const voiceGainMemory = new Map(); // resolved voice id -> last applied linear gain
const voiceLevelEma = new Map(); // resolved inworld voice id -> smoothed speech RMS (dBFS)
const voicePeakEma = new Map(); // resolved inworld voice id -> smoothed peak sample magnitude (linear, 0-32768)

function measureSpeechRmsDb(pcmBuf, sampleRate) {
  const samples = pcmBuf.length >> 1;
  const win = Math.max(1, Math.round(sampleRate * 0.03)); // 30ms windows
  if (samples < win) return null;
  const winRms = [];
  for (let start = 0; start + win <= samples; start += win) {
    let sum = 0;
    for (let i = start; i < start + win; i++) {
      const s = pcmBuf.readInt16LE(i * 2) / 32768;
      sum += s * s;
    }
    winRms.push(Math.sqrt(sum / win));
  }
  if (!winRms.length) return null;
  const peakWin = Math.max(...winRms);
  if (peakWin <= 0.0005) return null; // effectively silent clip -- leave it alone
  const gate = Math.max(peakWin * 0.1, 0.001);
  let acc = 0;
  let n = 0;
  for (const r of winRms) {
    if (r >= gate) {
      acc += r * r;
      n++;
    }
  }
  if (!n) return null;
  return 20 * Math.log10(Math.sqrt(acc / n));
}

function normalizeLoudness(pcmBuf, sampleRate, voiceKey, opts = {}) {
  if (!TTS_NORM_ENABLED || !pcmBuf || pcmBuf.length < 4) return pcmBuf;
  try {
    const rmsDb = measureSpeechRmsDb(pcmBuf, sampleRate);
    if (rmsDb == null) return pcmBuf;

    // Per-voice smoothing: longer clips are better level evidence, so they
    // move the running estimate more. A 1s phone sentence nudges it; a full
    // chat reply mostly IS it. First measurement stands on its own.
    const prior = voiceLevelEma.get(voiceKey);
    const durSec = (pcmBuf.length >> 1) / sampleRate;
    const alpha = Math.min(0.5, Math.max(0.1, durSec / 20));
    // Divergence guard (July 16 2026): the EMA smooths NORMAL wobble; when a
    // clip lands > TTS_NORM_SNAP_DB off the estimate, following the estimate
    // over-gains the clip and then audibly walks the level back as the EMA
    // converges (Kade's web call: +7.5 dB on clip 1 decaying to +0.4 dB within
    // 30 seconds, because fucia's estimate sat ~9 dB quiet from earlier
    // audition clips). Snap to the clip; the peak estimate below snaps with it
    // (same staleness, same reason).
    const snapped = prior != null && Math.abs(rmsDb - prior) > TTS_NORM_SNAP_DB;
    const level = prior == null || snapped ? rmsDb : prior + (rmsDb - prior) * alpha;
    voiceLevelEma.set(voiceKey, level);

    let gainDb = TTS_NORM_TARGET_DB - level;
    gainDb = Math.min(TTS_NORM_MAX_BOOST_DB, Math.max(-TTS_NORM_MAX_CUT_DB, gainDb));
    let gain = Math.pow(10, gainDb / 20);

    // Peak limiter: if the wanted boost would clip, back off to just-under-full-scale.
    const total = pcmBuf.length >> 1;
    let peak = 0;
    for (let i = 0; i < total; i++) {
      const a = Math.abs(pcmBuf.readInt16LE(i * 2));
      if (a > peak) peak = a;
    }
    // Smoothed peak (July 16 2026 fix -- Kade: intermittent "ducking"). Used to
    // hard-clamp gain for the WHOLE clip off this clip's own raw instant peak --
    // one emphasized word or hard consonant in an otherwise normal-level clip
    // would yank gain down for the entire clip, audible as a dip against its
    // neighbors. Now smoothed per-voice with the same duration-weighted alpha
    // as the RMS level above, so one spike can't single-handedly duck a whole
    // reply. The per-sample hard clamp a few lines down (32767/-32768) is the
    // real safety net -- if a genuinely new peak ever exceeds this smoothed
    // estimate, at most that instant briefly hard-clips rather than the whole
    // clip getting ducked; first clip for a voice still gets full unsmoothed
    // protection since priorPeak is null.
    if (peak > 0) {
      const priorPeak = voicePeakEma.get(voiceKey);
      const peakLevel = priorPeak == null || snapped ? peak : priorPeak + (peak - priorPeak) * alpha;
      voicePeakEma.set(voiceKey, peakLevel);
      gain = Math.min(gain, (32000 / peakLevel) * TTS_NORM_LIMIT_HEADROOM);
      // Absolute ceiling against THIS clip's raw true peak (see const above).
      gain = Math.min(gain, (32000 * TTS_NORM_MAX_OVERDRIVE) / peak);
    }

    // KNEE BUDGET (Aug 6): trim gain until saturator engagement fits the
    // budget — loudness up to the point of audible texture change, never past.
    if (gain > 1) {
      for (let guard = 0; guard < 12; guard++) {
        let over = 0;
        for (let i = 0; i < total; i += 4) { // stride-4 scan: plenty of samples, quarter cost
          if (Math.abs(pcmBuf.readInt16LE(i * 2)) * gain > TTS_NORM_KNEE) over++;
        }
        if (over / Math.ceil(total / 4) <= TTS_NORM_KNEE_BUDGET) break;
        gain *= 0.92;
        if (gain <= 1) { gain = Math.max(gain, 1); break; }
      }
    }

    const prevGain = voiceGainMemory.get(voiceKey);
    voiceGainMemory.set(voiceKey, gain);

    /* Part 98 — MEASURE-ONLY MODE, for the streamed lane. The stream already
     * flushed its bytes with the voice's REMEMBERED gain (it cannot re-read
     * them), so this call runs the exact same measurement + gain math on the
     * accumulated raw PCM purely to UPDATE the per-voice memory for the NEXT
     * clip, and touches no samples. The gain recorded above is the gain this
     * clip WOULD have gotten — one EMA step ahead of what actually played,
     * which is exactly the number the next clip should start from. */
    if (opts.measureOnly) {
      console.log(
        `[TTS] normalize (measure-only, streamed): voice="${voiceKey}" measured ${rmsDb.toFixed(1)} dBFS (level ${level.toFixed(1)}${snapped ? " SNAPPED" : ""}), next-clip gain ${(20 * Math.log10(gain)).toFixed(1)} dB`
      );
      return pcmBuf;
    }
    const rampSamples =
      prevGain != null && Math.abs(prevGain - gain) > 0.02
        ? Math.min(total, Math.max(32, Math.round((sampleRate * TTS_NORM_RAMP_MS) / 1000)))
        : 0;

    if (Math.abs(gain - 1) < 0.03 && rampSamples === 0) return pcmBuf; // ~0.25 dB, not worth touching
    // Soft-knee limiter (July 16 2026, replaces the bare hard clamp). The
    // smoothed peak cap above deliberately tolerates this clip's true peak
    // exceeding the estimate -- that is exactly what stops one transient from
    // ducking a whole clip -- so the overage must be absorbed HERE, gracefully.
    // The old hard clamp turned it into flat-topped clipping (Kade's "very
    // loud and low quality" web call). tanh knee: transparent below KNEE,
    // saturates smoothly toward full scale above it, can never clip.
    let kneed = 0;
    for (let i = 0; i < total; i++) {
      // Ramp: glide from the voice's previous clip gain to this clip's over
      // the opening TTS_NORM_RAMP_MS — level changes become inaudible slopes.
      const g = i < rampSamples ? prevGain + ((gain - prevGain) * i) / rampSamples : gain;
      let v = pcmBuf.readInt16LE(i * 2) * g;
      const a = Math.abs(v);
      if (a > TTS_NORM_KNEE) {
        v = Math.sign(v) * (TTS_NORM_KNEE + TTS_NORM_KNEE_RANGE * Math.tanh((a - TTS_NORM_KNEE) / TTS_NORM_KNEE_RANGE));
        kneed++;
      }
      pcmBuf.writeInt16LE(Math.round(v), i * 2);
    }
    console.log(
      `[TTS] normalize: voice="${voiceKey}" measured ${rmsDb.toFixed(1)} dBFS (level ${level.toFixed(1)}${snapped ? " SNAPPED" : ""}), applied ${(20 * Math.log10(gain)).toFixed(1)} dB${rampSamples ? ` (ramped from ${(20 * Math.log10(prevGain)).toFixed(1)} dB over ${TTS_NORM_RAMP_MS}ms)` : ""}${kneed ? `, soft-limited ${kneed}/${total} samples (${((100 * kneed) / total).toFixed(2)}%)` : ""}`
    );
  } catch (e) {
    console.warn("[TTS] normalize skipped:", e.message);
  }
  return pcmBuf;
}

// ── Multi-speaker scenes — synth glue (Aug 6 2026, ideas 16+52) ─────────────
// Script format + parser live in scene-engine.js. This side owns casting and
// audio: each segment synthesizes on its own voice through the SAME chunking,
// steering shaping, retry ladders, and per-voice loudness memory as a normal
// reply, then segments stitch with a speaker gap. One WAV out — so save-voice-
// message, read-aloud, conversation mode AND the phone (telephony=1) all get
// scenes for free.
//
// CASTING, three rungs (first hit wins), all fail-soft to the base voice:
//   1. "[[Voice 214]]" — a numbered voice straight out of VOICE_MAP.
//   2. "[[Deuce]]" + SCENE_CAST env ("deuce=Voice 33;miss opal=Voice 214") —
//      zero-latency name casting, survives restarts, no deploy to change.
//   3. "[[Deuce]]" dynamic — the proxy asks its own /librechat/agents lane
//      (same admin session Forge uses) for an agent by that name and reads
//      the builder-set tts.voiceId off the record; cached 6h, negative-cached
//      15min, and skipped entirely when LIBRECHAT_PROXY_SECRET isn't set.
//      First-time lookups ride the librechat.js 4s pacing queue, so a brand
//      new name can add a few seconds ONCE — then it's instant from cache.
const SCENE_MAX_SEGMENTS = parseInt(process.env.SCENE_MAX_SEGMENTS || "24", 10);
const SCENE_GAP_MS = parseInt(process.env.SCENE_GAP_MS || "280", 10); // beat between speakers; GAP_MS still rules within one speaker
const SCENE_CAST_ENV = parseAssignments(process.env.SCENE_CAST);
if (SCENE_CAST_ENV.size) console.log(`[TTS] scene cast env loaded: ${SCENE_CAST_ENV.size} names`);

const sceneNameCache = new Map(); // lowercased name -> { value: voiceId|null, at }
const SCENE_CAST_HIT_TTL_MS = 6 * 60 * 60 * 1000;
const SCENE_CAST_MISS_TTL_MS = 15 * 60 * 1000;
let sceneAgentIndex = { at: 0, byName: null }; // lowercased name -> agent id

async function sceneSelfFetch(path) {
  const secret = process.env.LIBRECHAT_PROXY_SECRET;
  if (!secret) throw new Error("LIBRECHAT_PROXY_SECRET not set (dynamic scene casting off)");
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!r.ok) throw new Error(`self ${path} -> ${r.status}`);
  return r.json();
}

async function sceneAgentIndexFresh() {
  if (sceneAgentIndex.byName && Date.now() - sceneAgentIndex.at < SCENE_CAST_MISS_TTL_MS) return sceneAgentIndex.byName;
  const byName = new Map();
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    const qs = cursor ? `?limit=500&cursor=${encodeURIComponent(cursor)}` : "?limit=500";
    const d = await sceneSelfFetch(`/librechat/agents${qs}`);
    for (const a of d.agents || []) if (a && a.name && a.id) byName.set(String(a.name).trim().toLowerCase(), a.id);
    if (!d.has_more || !d.after) break;
    cursor = d.after;
  }
  sceneAgentIndex = { at: Date.now(), byName };
  return byName;
}

// Resolve one script label to a synthesizable voice id. Returns null when the
// label can't cast (caller falls back to the message's base voice + logs).
async function resolveSceneVoiceId(label) {
  if (!label) return null;
  if (VOICE_MAP[label]) return VOICE_MAP[label]; // rung 1: "Voice 214"
  const key = label.toLowerCase();
  const envHit = SCENE_CAST_ENV.get(key); // rung 2: env cast
  if (envHit) return VOICE_MAP[envHit] || envHit;
  const cached = sceneNameCache.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? SCENE_CAST_HIT_TTL_MS : SCENE_CAST_MISS_TTL_MS)) {
    return cached.value;
  }
  try { // rung 3: agent record lookup
    const byName = await sceneAgentIndexFresh();
    const agentId = byName.get(key);
    if (!agentId) throw new Error(`no agent named "${label}"`);
    const rec = await sceneSelfFetch(`/librechat/agent?id=${encodeURIComponent(agentId)}`);
    const voiceId = rec && rec.tts && rec.tts.voiceId ? (VOICE_MAP[rec.tts.voiceId] || rec.tts.voiceId) : null;
    sceneNameCache.set(key, { value: voiceId, at: Date.now() });
    console.log(`[TTS] scene cast resolved: "${label}" -> ${voiceId || "(no builder voice; base will cover)"}`);
    return voiceId;
  } catch (e) {
    sceneNameCache.set(key, { value: null, at: Date.now() });
    console.warn(`[TTS] scene cast lookup failed for "${label}": ${e.message} — base voice covers the line`);
    return null;
  }
}

// Synthesize one cast segment through the normal per-provider pipeline and
// return { pcm, fmt } with loudness already normalized on ITS voice's memory.
async function synthesizeSceneSegment(seg, inworldModel, speakingRate) {
  const segIsFish = typeof seg.voiceId === "string" && seg.voiceId.startsWith(FISH_VOICE_PREFIX);
  const steered = applySteeringTags(seg.text);
  const chunks = (segIsFish
    ? chunkText(steered).map(seedFishSteering)
    : chunkText(steered).flatMap(shapeInworldSteering)
  ).filter(chunkHasSpeakableWords);
  if (!chunks.length) {
    // a castmate whose whole part was a bare direction contributes silence
    const fmt = { numChannels: 1, sampleRate: 24000, bitsPerSample: 16 };
    return { pcm: Buffer.alloc(0), fmt };
  }
  const wavs = await Promise.all(
    chunks.map((c, cj) =>
      segIsFish
        ? fishSynthesizeChunk(c, seg.voiceId.slice(FISH_VOICE_PREFIX.length), speakingRate)
        : (() => {
            const { text: sayText, instruction } = splitChunkForInworld(c);
            return synthesizeChunk(sayText, seg.voiceId, inworldModel, speakingRate, instruction, contextFor(chunks, cj));
          })()
    )
  );
  const parsed = wavs.map(parseWav);
  const fmt = {
    numChannels: parsed[0].numChannels,
    sampleRate: parsed[0].sampleRate,
    bitsPerSample: parsed[0].bitsPerSample,
  };
  const gap = parsed.length > 1 ? buildSilence(GAP_MS, fmt) : Buffer.alloc(0);
  const edgeFade = Math.max(48, Math.round(fmt.sampleRate * 0.005));
  const pieces = [];
  parsed.forEach((p, i) => {
    // Aug 18 2026: trim the provider's own ragged silence off INNER edges only
    // so `gap` is the whole seam (see GAP_MS). Outer edges stay untouched.
    const trimmed = trimEdgeSilence(p.data, fmt, { head: i > 0, tail: i < parsed.length - 1 });
    pieces.push(fadePcmEdges(trimmed, edgeFade));
    if (i < parsed.length - 1) pieces.push(gap);
  });
  const pcm = Buffer.concat(pieces);
  normalizeLoudness(pcm, fmt.sampleRate, seg.voiceId);
  return { pcm, fmt };
}

// The scene lane. Returns true when it fully answered the request; false
// hands the text (tags stripped) back to the single-voice lane — which is
// also the error posture: a castmate's provider having a bad minute must
// never kill the message, it just plays on the base voice.
async function trySynthesizeScene(req, res, preppedText, ctx) {
  let segments;
  try {
    segments = parseSceneScript(preppedText);
  } catch (e) {
    console.warn(`[TTS] scene parse failed (${e.message}) — single-voice lane takes it`);
    return false;
  }
  if (segments.length < 2 && !(segments.length === 1 && segments[0].label)) return false;
  if (segments.length > SCENE_MAX_SEGMENTS) {
    // Cost cap: overflow lines merge into the final speaker instead of 409ing
    // a family radio drama that ran long.
    const keep = segments.slice(0, SCENE_MAX_SEGMENTS - 1);
    const tail = segments.slice(SCENE_MAX_SEGMENTS - 1);
    keep.push({ label: tail[0].label, text: tail.map((s) => s.text).join("\n\n") });
    segments = keep;
    console.warn(`[TTS] scene segment cap hit — merged overflow into final speaker (cap ${SCENE_MAX_SEGMENTS})`);
  }

  const cast = [];
  for (const seg of segments) {
    let voiceId = seg.label == null ? ctx.baseVoiceId : await resolveSceneVoiceId(seg.label);
    if (!voiceId) voiceId = ctx.baseVoiceId;
    const segIsFish = typeof voiceId === "string" && voiceId.startsWith(FISH_VOICE_PREFIX);
    if ((segIsFish && !FISH_API_KEY) || (!segIsFish && !INWORLD_API_KEY)) {
      console.warn(`[TTS] scene segment provider key missing for ${voiceId} — base voice covers the line`);
      voiceId = ctx.baseVoiceId;
    }
    cast.push({ ...seg, voiceId });
  }
  // A real scene = two-plus distinct voices, OR a whole-message recast onto a
  // single castmate ("read this in Deuce's voice") that differs from base.
  const distinctIds = new Set(cast.map((c) => c.voiceId));
  if (distinctIds.size < 2 && !cast.some((c) => c.voiceId !== ctx.baseVoiceId)) {
    console.log("[TTS] scene tags present but every line cast to the base voice — single-voice lane takes it");
    return false;
  }

  try {
    const t0 = Date.now();
    const rendered = await Promise.all(cast.map((seg) => synthesizeSceneSegment(seg, ctx.inworldModel, ctx.speakingRate)));

    // Common-format guard: both providers run 24k/mono/16 today, but a drift
    // must degrade to a downsample, never to chipmunk audio.
    const minRate = Math.min(...rendered.map((r) => r.fmt.sampleRate));
    const format = { numChannels: rendered[0].fmt.numChannels, sampleRate: minRate, bitsPerSample: rendered[0].fmt.bitsPerSample };
    const sceneGap = buildSilence(SCENE_GAP_MS, format);
    const pieces = [];
    rendered.forEach((r, i) => {
      pieces.push(r.fmt.sampleRate === minRate ? r.pcm : downsamplePcm(r.pcm, r.fmt.sampleRate, minRate));
      if (i < rendered.length - 1) pieces.push(sceneGap);
    });
    const combinedData = Buffer.concat(pieces);
    const header = buildWavHeader(combinedData.length, format);
    const finalAudio = Buffer.concat([header, combinedData]);
    console.log(`[TTS] scene ok: ${cast.length} segments, ${new Set(cast.map((c) => c.voiceId)).size} voices, ${Date.now() - t0}ms (telephony=${req.query.telephony === "1" ? "yes" : "no"})`);

    if (req.query.telephony === "1") {
      const wav = parseWav(finalAudio);
      const pcm8k = fadePcmEdges(downsamplePcm(wav.data, wav.sampleRate, 8000));
      const mulaw = pcm16ToMulaw(pcm8k);
      res.set("Content-Type", "audio/basic");
      res.set("Content-Length", mulaw.length);
      res.send(mulaw);
      return true;
    }
    const audioFingerprint = crypto.createHash("sha256").update(combinedData).digest("hex").slice(0, 16);
    console.log(`[TTS] scene response: base="${ctx.baseVoiceLabel}" fingerprint=${audioFingerprint} bytes=${combinedData.length}`);
    res.set("Content-Type", "audio/wav");
    res.set("Content-Length", finalAudio.length);
    res.send(finalAudio);
    return true;
  } catch (err) {
    console.error(`[TTS] scene synth failed (${err.message}) — single-voice lane takes the message`);
    return false;
  }
}

app.post("/v1/audio/speech", async (req, res) => {
  const { input, voice = "alloy", model = "tts-1", speed } = req.body;
  // Per-request speaking rate (Kade D2d): optional OpenAI-style `speed`,
  // clamped to Inworld's sane range; absent -> the global TTS_SPEAKING_RATE.
  // Inworld hard range is 0.5-1.5 (verified live 2026-07-01: 1.8 and 2.0
  // return HTTP 400 "speakingRate should be within the range of 0.5 to 1.5").
  const speakingRate =
    typeof speed === "number" && isFinite(speed)
      ? Math.min(1.5, Math.max(0.5, speed))
      : undefined;

  if (!input) {
    return res.status(400).json({ error: "Missing required field: input" });
  }

  // Native-app voice previews (July 22 2026, Kade: picker previews said only
  // "Hi there. This is how I sound." -- "I'd like it to be longer like in the
  // agent builder on the web"): the iOS/Android apps hardcode that short
  // sentence client-side (VoiceService.previewVoice's default sample), so the
  // upgrade lives HERE at the synth funnel -- every build already installed
  // gets it with no app update. Exact-match on the sentinel only (no other
  // lane sends this string); it becomes the SAME performed audition line the
  // web agent builder plays (AUDITION_TEXT, defined with the catalog below),
  // with the requested voice label speaking its own name -- {voice} filled
  // server-side since the app, unlike the web picker, never does it. The %%%
  // steering resolves in applySteeringTags a few lines down, same pipeline as
  // every other audition.
  const NATIVE_PREVIEW_SENTINEL = "Hi there. This is how I sound.";
  let effectiveInput = input;
  if (typeof input === "string" && input.trim() === NATIVE_PREVIEW_SENTINEL) {
    effectiveInput = AUDITION_TEXT.split("{voice}").join(String(voice));
    console.log(`[TTS] native preview sentinel swapped for audition line, label="${voice}"`);
  }

  const inworldVoice = VOICE_MAP[voice] || voice;
  const inworldModel = MODEL_MAP[model] || "inworld-tts-2";
  // Provider fork: "fish:<model_id>" targets go to fish.audio, everything else
  // to Inworld. Key checks are per-provider so an unset FISH_API_KEY can never
  // take down Inworld voices (and vice versa).
  const isFishVoice = typeof inworldVoice === "string" && inworldVoice.startsWith(FISH_VOICE_PREFIX);
  if (isFishVoice && !FISH_API_KEY) {
    return res.status(500).json({ error: "FISH_API_KEY not set on this service (needed for Voice 327+)" });
  }
  if (!isFishVoice && !INWORLD_API_KEY) {
    return res.status(500).json({ error: "INWORLD_API_KEY not set" });
  }
  // Diagnostic (July 16 2026, Kade: voice samples reportedly drifting to the
  // wrong timbre deeper into the picker, varying session to session, on
  // every device -- ruled out client code, the concurrency limiter, and
  // basic model-stochasticity via direct testing, so this logs the requested
  // label -> resolved id mapping for every call. If it happens again, the
  // exact request can be found in Railway logs by timestamp instead of
  // guessed at after the fact.
  console.log(`[TTS] voice request: label="${voice}" -> resolved="${inworldVoice}"`);

  // Strip web-search citation markers before speaking. The search-augmented
  // model embeds inline citation tokens (a private-use char U+E200-U+E20F
  // followed by a "turn0search3"-style id) into its answer; these render as
  // source chips in the UI but TTS otherwise reads them aloud as gibberish
  // mid-sentence. Visible message text is untouched (this only cleans audio).
  // Game Parlor sound cues ([sound:card_deal] etc., see the fork's
  // client/src/utils/gameSounds.ts): the web client plays these as real
  // clips; on the TTS path they must simply vanish so no surface ever
  // SPEAKS the token. Same hygiene class as citation markers.
  // Prep chain minus steering first: scenes must split BEFORE steering so
  // each speaker's %%% carry-forward stays inside their own lines.
  const preppedText = fixPronunciations(normalizeForSpeech(stripSpeechMarkdown(stripCitationMarkers(emphasisFromMarkdown(rescueLooseDirections(stripThinkingBlock(effectiveInput))))))).replace(/\[(?:sound:[a-z0-9_]+|table:[a-z0-9]{1,12})\]/gi, '');

  // Multi-speaker scene lane (Aug 6 2026): double-bracket speaker tags turn a
  // message into a stitched multi-voice performance. Anything short of a real
  // 2+ voice scene falls straight through to the classic single-voice lane
  // with the tags stripped — never spoken, never fatal.
  if (SCENE_TAG_RE.test(preppedText)) {
    const handled = await trySynthesizeScene(req, res, preppedText, {
      baseVoiceLabel: voice,
      baseVoiceId: inworldVoice,
      inworldModel,
      speakingRate,
    });
    if (handled) return;
  }

  const ttsSessionKey = String(req.get("x-kade-tts-session") || "").slice(0, 64) || null;
  const speakText = applySteeringTags(preppedText.replace(SCENE_TAG_G, " ").replace(/[ \t]{2,}/g, " "));
  console.log(`[TTS] input len=${effectiveInput.length}, after strip len=${speakText.length}, first 200: ${JSON.stringify(speakText.slice(0,200))}`);
  // If stripping removed all content (e.g. LibreChat sent thinking-only TTS call), return silence
  if (!speakText.trim()) {
    console.log('[TTS] nothing to speak after stripping — returning empty audio');
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': '0' });
    return res.status(200).end();
  }

  try {
    // Provider-aware steering shaping (Aug 3 2026, see helpers above): fish
    // re-seeds the active direction per sentence; Inworld gets one direction
    // per request (identical repeats dropped, real changes split the chunk).
    const chunks = (isFishVoice
      ? chunkText(speakText).map(seedFishSteering)
      : chunkText(speakText).flatMap(shapeInworldSteering)
    ).filter(chunkHasSpeakableWords);
    if (!chunks.length) {
      console.log('[TTS] every chunk was words-free after shaping — returning silence, not a 500');
      res.set({ 'Content-Type': 'audio/wav', 'Content-Length': '0' });
      return res.status(200).end();
    }

    /* Part 98 — the streamed lane. Opt-in per request (the native app's new
     * player sends the flag; web and telephony never do), Inworld only for
     * now (fish voices fall through to buffered — zero fish voices in live
     * rotation to even hear it), and single-chunk only: seams, gaps and
     * inner trims are whole-set operations that need every chunk in hand,
     * and the app lane's one-sentence-per-call requests are single-chunk in
     * practice. A false return means NOTHING was flushed and the buffered
     * path below runs exactly as it always has. */
    const wantsStream =
      TTS_STREAM_ENABLED &&
      !isFishVoice &&
      req.query.telephony !== "1" &&
      chunks.length === 1 &&
      (req.get("x-kade-tts-stream") === "1" || req.body.stream === "1" || req.body.stream === true);
    if (wantsStream) {
      const handled = await tryStreamSingleChunk(res, {
        chunk: chunks[0],
        inworldVoice,
        inworldModel,
        speakingRate,
        previousTexts: contextFor(chunks, 0, ttsSessionKey),
        voiceLabel: voice,
      });
      if (handled) {
        rememberSpoken(ttsSessionKey, speakText);
        return;
      }
    }

    // Fire every chunk at Inworld in parallel instead of waiting on one
    // giant request -- this is the actual latency fix.
    const tSynth = Date.now();
    const wavBuffers = await Promise.all(
      chunks.map((chunk, ci) =>
        isFishVoice
          ? fishSynthesizeChunk(chunk, inworldVoice.slice(FISH_VOICE_PREFIX.length), speakingRate)
          : (() => {
              const { text: sayText, instruction } = splitChunkForInworld(chunk);
              return synthesizeChunk(sayText, inworldVoice, inworldModel, speakingRate, instruction, contextFor(chunks, ci, ttsSessionKey));
            })()
      )
    );
    console.log(`[TTS] synth ok: ${chunks.length} chunk(s) in ${Date.now() - tSynth}ms (telephony=${req.query.telephony === "1" ? "yes" : "no"})`);
    /* Remember what this seat just said, so the NEXT call — which on the app
     * lane is the next sentence of the same reply — has something to go on.
     * Only after a successful synthesis: a failed call was never heard, and
     * feeding it forward would give the next sentence context for audio that
     * does not exist. */
    rememberSpoken(ttsSessionKey, speakText);

    const parsed = wavBuffers.map(parseWav);
    const format = {
      numChannels: parsed[0].numChannels,
      sampleRate: parsed[0].sampleRate,
      bitsPerSample: parsed[0].bitsPerSample,
    };

    const silence = chunks.length > 1 ? buildSilence(GAP_MS, format) : Buffer.alloc(0);

    // July 23 2026 (Kade: "some of them kinda pop and click"): each chunk is a
    // separate synth response and can start/end at a non-zero sample (fish's
    // raw-pcm responses especially) -- butting that against the silence gap or
    // the player's own start is a step discontinuity, audible as a click/pop.
    // ~5ms edge fades per chunk (scaled to the real sample rate; 48-sample
    // floor) are inaudible as fades and remove the step entirely. The
    // telephony lane keeps its whole-message fade after downsample too.
    const edgeFade = Math.max(48, Math.round(format.sampleRate * 0.005));
    const pieces = [];
    let trimmedMs = 0;
    parsed.forEach((p, i) => {
      // Aug 18 2026 (her "random commas"): Inworld hands back 460-605ms of
      // trailing silence per chunk. Butting that against our gap made every
      // seam ~655ms -- longer than a real period. Trim the INNER edges so
      // `silence` (GAP_MS) is the entire seam. Outer edges untouched on
      // purpose: better a little air than a clipped first or last word.
      const trimmed = trimEdgeSilence(p.data, format, { head: i > 0, tail: i < parsed.length - 1 });
      trimmedMs += Math.round(((p.data.length - trimmed.length) / (format.numChannels * 2)) / format.sampleRate * 1000);
      pieces.push(fadePcmEdges(trimmed, edgeFade));
      if (i < parsed.length - 1) pieces.push(silence);
    });
    if (parsed.length > 1) {
      console.log(`[TTS] seams: ${parsed.length - 1} @ ${GAP_MS}ms (trimmed ${trimmedMs}ms of provider dead air, trim=${TRIM_SEAMS ? "on" : "off"})`);
    }

    const combinedData = Buffer.concat(pieces);
    normalizeLoudness(combinedData, format.sampleRate, inworldVoice);
    const header = buildWavHeader(combinedData.length, format);
    const finalAudio = Buffer.concat([header, combinedData]);

    // Telephony mode: return raw μ-law 8kHz for Twilio Media Streams
    if (req.query.telephony === "1") {
      const wav = parseWav(finalAudio);
      const pcm8k = fadePcmEdges(downsamplePcm(wav.data, wav.sampleRate, 8000));
      const mulaw = pcm16ToMulaw(pcm8k);
      console.log(`[TTS] telephony out: ${mulaw.length} bytes mulaw from ${wav.sampleRate}Hz source`);
      res.set("Content-Type", "audio/basic");
      res.set("Content-Length", mulaw.length);
      return res.send(mulaw);
    }
    const audioFingerprint = crypto.createHash("sha256").update(combinedData).digest("hex").slice(0, 16);
    console.log(`[TTS] voice response: label="${voice}" resolved="${inworldVoice}" fingerprint=${audioFingerprint} bytes=${combinedData.length}`);
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
// 2026-07-01: renamed to plain numbered labels ("Voice 1".. "Voice 210") per Kade's
// request -- same voices, same order, just no descriptive names in the picker anymore.
// The old OpenAI-style aliases (alloy/echo/fable/onyx/nova/shimmer) are gone from this
// display list entirely now -- OPENAI_ALIAS_MAP still resolves them for any internal
// LibreChat calls that hardcode those names, they just never show up in the picker.
const VOICE_LIST = ["Voice 1", "Voice 2", "Voice 3", "Voice 4", "Voice 5", "Voice 6", "Voice 7", "Voice 8", "Voice 9", "Voice 10", "Voice 11", "Voice 12", "Voice 13", "Voice 14", "Voice 15", "Voice 16", "Voice 17", "Voice 18", "Voice 19", "Voice 20", "Voice 21", "Voice 22", "Voice 23", "Voice 24", "Voice 25", "Voice 26", "Voice 27", "Voice 28", "Voice 29", "Voice 30", "Voice 31", "Voice 32", "Voice 33", "Voice 34", "Voice 35", "Voice 36", "Voice 37", "Voice 38", "Voice 39", "Voice 40", "Voice 41", "Voice 42", "Voice 43", "Voice 44", "Voice 45", "Voice 46", "Voice 47", "Voice 48", "Voice 49", "Voice 50", "Voice 51", "Voice 52", "Voice 53", "Voice 54", "Voice 55", "Voice 56", "Voice 57", "Voice 58", "Voice 59", "Voice 60", "Voice 61", "Voice 62", "Voice 63", "Voice 64", "Voice 65", "Voice 66", "Voice 67", "Voice 68", "Voice 69", "Voice 70", "Voice 71", "Voice 72", "Voice 73", "Voice 74", "Voice 75", "Voice 76", "Voice 77", "Voice 78", "Voice 79", "Voice 80", "Voice 81", "Voice 82", "Voice 83", "Voice 84", "Voice 85", "Voice 86", "Voice 87", "Voice 88", "Voice 89", "Voice 90", "Voice 91", "Voice 92", "Voice 93", "Voice 94", "Voice 95", "Voice 96", "Voice 97", "Voice 98", "Voice 99", "Voice 100", "Voice 101", "Voice 102", "Voice 103", "Voice 104", "Voice 105", "Voice 106", "Voice 107", "Voice 108", "Voice 109", "Voice 110", "Voice 111", "Voice 112", "Voice 113", "Voice 114", "Voice 115", "Voice 116", "Voice 117", "Voice 118", "Voice 119", "Voice 120", "Voice 121", "Voice 122", "Voice 123", "Voice 124", "Voice 125", "Voice 126", "Voice 127", "Voice 128", "Voice 129", "Voice 130", "Voice 131", "Voice 132", "Voice 133", "Voice 134", "Voice 135", "Voice 136", "Voice 137", "Voice 138", "Voice 139", "Voice 140", "Voice 141", "Voice 142", "Voice 143", "Voice 144", "Voice 145", "Voice 146", "Voice 147", "Voice 148", "Voice 149", "Voice 150", "Voice 151", "Voice 152", "Voice 153", "Voice 154", "Voice 155", "Voice 156", "Voice 157", "Voice 158", "Voice 159", "Voice 160", "Voice 161", "Voice 162", "Voice 163", "Voice 164", "Voice 165", "Voice 166", "Voice 167", "Voice 168", "Voice 169", "Voice 170", "Voice 171", "Voice 172", "Voice 173", "Voice 174", "Voice 175", "Voice 176", "Voice 177", "Voice 178", "Voice 179", "Voice 180", "Voice 181", "Voice 182", "Voice 183", "Voice 184", "Voice 185", "Voice 186", "Voice 187", "Voice 188", "Voice 189", "Voice 190", "Voice 191", "Voice 192", "Voice 193", "Voice 194", "Voice 195", "Voice 196", "Voice 197", "Voice 198", "Voice 199", "Voice 200", "Voice 201", "Voice 202", "Voice 203", "Voice 204", "Voice 205", "Voice 206", "Voice 207", "Voice 208", "Voice 209", "Voice 210"];
// Derived: after the 2026-07-01 renumbering the customs ARE Voice 1-70.
const CUSTOM_VOICE_NUMBERS = new Set(
  Array.from({ length: 70 }, (_, i) => `Voice ${i + 1}`),
);

// ── 2026-07-12 VOICE ADDITIONS (Kade's new designed voices, clone-vetted) ──
// APPEND-ONLY as Voice 211+ so every number Kade and the family memorized
// stays exactly where it was. Same fail-safe idea as the renumber block:
// any drift crashes boot -> health check fails -> old deploy keeps serving.
const VOICE_ADDITIONS_2026_07_12 = {
  "Voice 211": "default-e-m11vgtr9l-m7afw4kmnw__amazed_woman",
  "Voice 212": "default-e-m11vgtr9l-m7afw4kmnw__angry_cartoon_dad",
  "Voice 213": "default-e-m11vgtr9l-m7afw4kmnw__anna_teen_female",
  "Voice 214": "default-e-m11vgtr9l-m7afw4kmnw__assia_black_female_casual",
  "Voice 215": "default-e-m11vgtr9l-m7afw4kmnw__bar_brit_guy",
  "Voice 216": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-56c25ad3",
  "Voice 217": "default-e-m11vgtr9l-m7afw4kmnw__bipolar_animated_emotions_guy",
  "Voice 218": "default-e-m11vgtr9l-m7afw4kmnw__black_dude1",
  "Voice 219": "default-e-m11vgtr9l-m7afw4kmnw__black_dude2",
  "Voice 220": "default-e-m11vgtr9l-m7afw4kmnw__black_male_podcaster",
  "Voice 221": "default-e-m11vgtr9l-m7afw4kmnw__black_male_podcaster2",
  "Voice 222": "default-e-m11vgtr9l-m7afw4kmnw__black_male_podcaster3",
  "Voice 223": "default-e-m11vgtr9l-m7afw4kmnw__casual_black_houston_woman",
  "Voice 224": "default-e-m11vgtr9l-m7afw4kmnw__casual_chef",
  "Voice 225": "default-e-m11vgtr9l-m7afw4kmnw__chef2",
  "Voice 226": "default-e-m11vgtr9l-m7afw4kmnw__daisy_black_female",
  "Voice 227": "default-e-m11vgtr9l-m7afw4kmnw__deep_voice_dan",
  "Voice 228": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-040c5300",
  "Voice 229": "default-e-m11vgtr9l-m7afw4kmnw__dj_for_kid_intersticials_female",
  "Voice 230": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-86be25f6",
  "Voice 231": "default-e-m11vgtr9l-m7afw4kmnw__dollya",
  "Voice 232": "default-e-m11vgtr9l-m7afw4kmnw__emma_stuffy_smoker_female",
  "Voice 233": "default-e-m11vgtr9l-m7afw4kmnw__emotional_male_rapper",
  "Voice 234": "default-e-m11vgtr9l-m7afw4kmnw__exotic_guy",
  "Voice 235": "default-e-m11vgtr9l-m7afw4kmnw__fabiola",
  "Voice 236": "default-e-m11vgtr9l-m7afw4kmnw__female_host_with_strong_accent",
  "Voice 237": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy_1",
  "Voice 238": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy_2",
  "Voice 239": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy4",
  "Voice 240": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy5",
  "Voice 241": "default-e-m11vgtr9l-m7afw4kmnw__fine_guy_6",
  "Voice 242": "default-e-m11vgtr9l-m7afw4kmnw__freddy_male_casual",
  "Voice 243": "default-e-m11vgtr9l-m7afw4kmnw__gamer_guy",
  "Voice 244": "default-e-m11vgtr9l-m7afw4kmnw__garrott_male",
  "Voice 245": "default-e-m11vgtr9l-m7afw4kmnw__granny_dianna",
  "Voice 246": "default-e-m11vgtr9l-m7afw4kmnw__granny_roothey",
  "Voice 247": "default-e-m11vgtr9l-m7afw4kmnw__grump_guy_1",
  "Voice 248": "default-e-m11vgtr9l-m7afw4kmnw__grump_guy_3",
  "Voice 249": "default-e-m11vgtr9l-m7afw4kmnw__grump_guy3",
  "Voice 250": "default-e-m11vgtr9l-m7afw4kmnw__harly_white_male",
  "Voice 251": "default-e-m11vgtr9l-m7afw4kmnw__hispanic_dude1",
  "Voice 252": "default-e-m11vgtr9l-m7afw4kmnw__hispanic_woman",
  "Voice 253": "default-e-m11vgtr9l-m7afw4kmnw__irish_preacher",
  "Voice 254": "default-e-m11vgtr9l-m7afw4kmnw__ivy",
  "Voice 255": "default-e-m11vgtr9l-m7afw4kmnw__jamaikan_granny",
  "Voice 256": "default-e-m11vgtr9l-m7afw4kmnw__jennie",
  "Voice 257": "default-e-m11vgtr9l-m7afw4kmnw__jennifer",
  "Voice 258": "default-e-m11vgtr9l-m7afw4kmnw__laurie_black_female",
  "Voice 259": "default-e-m11vgtr9l-m7afw4kmnw__luna",
  "Voice 260": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-64cbd04a",
  "Voice 261": "default-e-m11vgtr9l-m7afw4kmnw__male_podcaster",
  "Voice 262": "default-e-m11vgtr9l-m7afw4kmnw__martha_faith_souther_female",
  "Voice 263": "default-e-m11vgtr9l-m7afw4kmnw__maxie",
  "Voice 264": "default-e-m11vgtr9l-m7afw4kmnw__mean_female",
  "Voice 265": "default-e-m11vgtr9l-m7afw4kmnw__meeka",
  "Voice 266": "default-e-m11vgtr9l-m7afw4kmnw__mex_granny",
  "Voice 267": "default-e-m11vgtr9l-m7afw4kmnw__monica_young_female",
  "Voice 268": "default-e-m11vgtr9l-m7afw4kmnw__morgan",
  "Voice 269": "default-e-m11vgtr9l-m7afw4kmnw__mya_liyah",
  "Voice 270": "default-e-m11vgtr9l-m7afw4kmnw__nanny",
  "Voice 271": "default-e-m11vgtr9l-m7afw4kmnw__patunya_black_middle-age_female",
  "Voice 272": "default-e-m11vgtr9l-m7afw4kmnw__porker",
  "Voice 273": "default-e-m11vgtr9l-m7afw4kmnw__poser_dude",
  "Voice 274": "default-e-m11vgtr9l-m7afw4kmnw__posie_neutral_female",
  "Voice 275": "default-e-m11vgtr9l-m7afw4kmnw__professor_guy",
  "Voice 276": "default-e-m11vgtr9l-m7afw4kmnw__professor_guy2",
  "Voice 277": "default-e-m11vgtr9l-m7afw4kmnw__ren_professional_female",
  "Voice 278": "default-e-m11vgtr9l-m7afw4kmnw__russian_storyteller",
  "Voice 279": "default-e-m11vgtr9l-m7afw4kmnw__sally_may",
  "Voice 280": "default-e-m11vgtr9l-m7afw4kmnw__scary_male_pa_announcer",
  "Voice 281": "default-e-m11vgtr9l-m7afw4kmnw__southern_black_dude1",
  "Voice 282": "default-e-m11vgtr9l-m7afw4kmnw__southern_female_preacher1",
  "Voice 283": "default-e-m11vgtr9l-m7afw4kmnw__southern_female_preacher2",
  "Voice 284": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher1",
  "Voice 285": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher2",
  "Voice 286": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher3",
  "Voice 287": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher_4",
  "Voice 288": "default-e-m11vgtr9l-m7afw4kmnw__southern_preacher_jackle",
  "Voice 289": "default-e-m11vgtr9l-m7afw4kmnw__steevie_male_kid_friendly_host",
  "Voice 290": "default-e-m11vgtr9l-m7afw4kmnw__stereotypical_evil_brit",
  "Voice 291": "default-e-m11vgtr9l-m7afw4kmnw__surf_dude1",
  "Voice 292": "default-e-m11vgtr9l-m7afw4kmnw__surfin_stoner",
  "Voice 293": "default-e-m11vgtr9l-m7afw4kmnw__susu",
  "Voice 294": "default-e-m11vgtr9l-m7afw4kmnw__tanya_black_female_southern",
  "Voice 295": "default-e-m11vgtr9l-m7afw4kmnw__tess",
  "Voice 296": "default-e-m11vgtr9l-m7afw4kmnw__tilly_female",
  "Voice 297": "default-e-m11vgtr9l-m7afw4kmnw__tina",
  "Voice 298": "default-e-m11vgtr9l-m7afw4kmnw__toya",
  "Voice 299": "default-e-m11vgtr9l-m7afw4kmnw__trailer_guy",
  "Voice 300": "default-e-m11vgtr9l-m7afw4kmnw__understanding_female",
  "Voice 301": "default-e-m11vgtr9l-m7afw4kmnw__varonica",
  "Voice 302": "default-e-m11vgtr9l-m7afw4kmnw__whispering_female_ghostly_voice",
  "Voice 303": "default-e-m11vgtr9l-m7afw4kmnw__yelling_southern_preacher",
};
{
  const addLabels = Object.keys(VOICE_ADDITIONS_2026_07_12);
  if (addLabels.length !== 93) throw new Error(`voice additions: expected 93, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${211 + idx}`) throw new Error(`voice additions: non-contiguous at ${label}`);
    const target = VOICE_ADDITIONS_2026_07_12[label];
    if (!target.startsWith("default-e-")) throw new Error(`voice additions: ${label} is not a custom voice id`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`voice additions: ${label} collides with an existing alias`);
    NUMBERED_VOICE_ALIASES[label] = target;
    // VOICE_MAP was spread-snapshotted from the alias maps at definition time
    // (line ~466) — late additions must land in it explicitly or synthesis
    // passes the raw "Voice N" label to Inworld (found live July 12: 404).
    VOICE_MAP[label] = target;
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-07-12 EVENING ADDITIONS (21 more new voices from Kade) ──
const VOICE_ADDITIONS_2026_07_12B = {
  "Voice 304": "default-e-m11vgtr9l-m7afw4kmnw__aussie",
  "Voice 305": "default-e-m11vgtr9l-m7afw4kmnw__beasty",
  "Voice 306": "default-e-m11vgtr9l-m7afw4kmnw__beddy",
  "Voice 307": "default-e-m11vgtr9l-m7afw4kmnw__biscut_female",
  "Voice 308": "default-e-m11vgtr9l-m7afw4kmnw__gania",
  "Voice 309": "default-e-m11vgtr9l-m7afw4kmnw__hardware_guy",
  "Voice 310": "default-e-m11vgtr9l-m7afw4kmnw__heather",
  "Voice 311": "default-e-m11vgtr9l-m7afw4kmnw__historic_guy",
  "Voice 312": "default-e-m11vgtr9l-m7afw4kmnw__infomercial_guy",
  "Voice 313": "default-e-m11vgtr9l-m7afw4kmnw__irish_dude",
  "Voice 314": "default-e-m11vgtr9l-m7afw4kmnw__jason",
  "Voice 315": "default-e-m11vgtr9l-m7afw4kmnw__josh",
  "Voice 316": "default-e-m11vgtr9l-m7afw4kmnw__kylah",
  "Voice 317": "default-e-m11vgtr9l-m7afw4kmnw__marla",
  "Voice 318": "default-e-m11vgtr9l-m7afw4kmnw__nate",
  "Voice 319": "default-e-m11vgtr9l-m7afw4kmnw__ojo",
  "Voice 320": "default-e-m11vgtr9l-m7afw4kmnw__paul",
  "Voice 321": "default-e-m11vgtr9l-m7afw4kmnw__paulina",
  "Voice 322": "default-e-m11vgtr9l-m7afw4kmnw__another_quiet_man",
  "Voice 323": "default-e-m11vgtr9l-m7afw4kmnw__southern_guy_another",
  "Voice 324": "default-e-m11vgtr9l-m7afw4kmnw__wendi",
};
{
  const addLabels = Object.keys(VOICE_ADDITIONS_2026_07_12B);
  if (addLabels.length !== 21) throw new Error(`voice additions B: expected 21, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${304 + idx}`) throw new Error(`voice additions B: non-contiguous at ${label}`);
    const target = VOICE_ADDITIONS_2026_07_12B[label];
    if (!target.startsWith("default-e-")) throw new Error(`voice additions B: ${label} not a custom id`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`voice additions B: ${label} collides`);
    NUMBERED_VOICE_ALIASES[label] = target;
    VOICE_MAP[label] = target;
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-07-17 VOICE ADDITIONS (the new designed voices since the July 12
// sweep; the 15 held-back clones — Kade*, Amber*, Podcast Keighty fast, Sky,
// Dale — remain OUT per Kade's vet). APPEND-ONLY as Voice 325+ so every
// memorized number stays put. Same boot-crash rails as the blocks above.
const VOICE_ADDITIONS_2026_07_17 = {
  "Voice 325": "default-e-m11vgtr9l-m7afw4kmnw__kaylin_child",
  "Voice 326": "default-e-m11vgtr9l-m7afw4kmnw__kiki",
  "Voice 327": "default-e-m11vgtr9l-m7afw4kmnw__satarah",
  "Voice 328": "default-e-m11vgtr9l-m7afw4kmnw__trutia",
};
{
  const addLabels = Object.keys(VOICE_ADDITIONS_2026_07_17);
  if (addLabels.length !== 4) throw new Error(`voice additions C: expected 4, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${325 + idx}`) throw new Error(`voice additions C: non-contiguous at ${label}`);
    const target = VOICE_ADDITIONS_2026_07_17[label];
    if (!target.startsWith("default-e-")) throw new Error(`voice additions C: ${label} not a custom id`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`voice additions C: ${label} collides`);
    NUMBERED_VOICE_ALIASES[label] = target;
    VOICE_MAP[label] = target;
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-07-17 PICKER RETIREMENTS (Kade's call): christa and nanny leave
// every picker/audition surface. Their numbered map entries and name aliases
// STAY resolvable, so any agent default or saved personal pick that still
// points at them keeps speaking (fail-soft) — they just can't be newly chosen.
// This leaves display gaps on purpose; the integrity check below scans the MAP
// (still contiguous), so boot stays quiet.
// FIX 2026-07-18: christa is "Voice 11" under the 2026-07-01 renumber (old
// "Voice 118" - 107 = 11), NOT "Voice 118". The original block targeted the
// pre-renumber number, so it retired an innocent stock voice and left the real
// christa live at Voice 11 (Kade heard Voice 11 still playing christa). Nanny
// at "Voice 270" is a post-renumber addition label and was correct — left as is.
{
  const RETIRED_PICKER_VOICES = ["Voice 11", "Voice 270"];
  for (const label of RETIRED_PICKER_VOICES) {
    const i = VOICE_LIST.indexOf(label);
    if (i === -1) throw new Error(`picker retirement: ${label} not in VOICE_LIST`);
    VOICE_LIST.splice(i, 1);
    CUSTOM_VOICE_NUMBERS.delete(label);
  }
}

// ── 2026-07-17 GAP REFILL (Kade's call, evening session): the display gaps
// left by the picker retirements close by RENUMBERING two of today's four
// additions into the empty slots — satarah (was Voice 327) becomes Voice 11,
// trutia (was Voice 328) becomes Voice 270. Kade's exact words: "It doesn't
// matter who... You'll just be replacing the numbers of those voices."
// Consequences, on purpose: any saved pick that still pointed at christa
// (Voice 11) or nanny (Voice 270) now speaks as satarah/trutia respectively
// (the name aliases "Christa" and "Nanny" still resolve for anything
// name-based); the catalog is contiguous 1-326 again with no gaps and no 327/328.
// FIX 2026-07-18: slot corrected from "Voice 118" to "Voice 11" (see retirement
// block above) so satarah actually replaces christa. Voice 118 (a stock voice)
// is left untouched.
{
  const GAP_REFILL = { "Voice 11": "Voice 327", "Voice 270": "Voice 328" };
  for (const [slot, from] of Object.entries(GAP_REFILL)) {
    const target = NUMBERED_VOICE_ALIASES[from];
    if (!target) throw new Error(`gap refill: source ${from} missing from the numbered map`);
    if (VOICE_LIST.includes(slot)) throw new Error(`gap refill: ${slot} unexpectedly still in the picker`);
    NUMBERED_VOICE_ALIASES[slot] = target;
    VOICE_MAP[slot] = target;
    delete NUMBERED_VOICE_ALIASES[from];
    delete VOICE_MAP[from];
    const i = VOICE_LIST.indexOf(from);
    if (i === -1) throw new Error(`gap refill: source ${from} missing from VOICE_LIST`);
    VOICE_LIST.splice(i, 1);
    CUSTOM_VOICE_NUMBERS.delete(from);
    VOICE_LIST.push(slot);
    CUSTOM_VOICE_NUMBERS.add(slot);
  }
  VOICE_LIST.sort((a, b) => Number(a.replace("Voice ", "")) - Number(b.replace("Voice ", "")));
}


// Old picker spellings that must keep resolving but never show in a picker.
// Served as /voices.json `hidden` for the fork's validators. APPEND-ONLY.
const HIDDEN_VOICE_ALIASES = [];

// ── 2026-07-22 FISH AUDIO ADDITIONS (Kade's picked 142 of her 195 fish.audio
// clones; her supervised pick session, this date). APPEND-ONLY as Voice 327+
// (327/328 are free slots again after the July 17 gap-refill renumber).
// Targets are "fish:<fish model id>" — routed to fishSynthesizeChunk at synth.
// BETA GRADUATED July 23 2026 (Kade: "I've decided I don't want to call the
// fish voices beta, and I want to mix the fish voices up with the inworld
// voices"): pickers now display plain "Voice N" (plus a name on her eight
// labeled ones). Exactly as the original beta plan prescribed, every old
// "(Beta)" spelling stays resolvable as a HIDDEN alias FOREVER — saved
// personal picks and agent tts objects still carry the old strings (same
// fail-soft rule as the christa/nanny retirements above). The hidden list is
// also SERVED (/voices.json `hidden`) so the fork's validators can accept
// stored old spellings without showing them in any picker. The BARE "Voice N"
// keys stay registered in NUMBERED_VOICE_ALIASES + VOICE_MAP so spoken number
// switching ("switch to 340") and the boot integrity check work untouched.
// PRIVACY NOTE: "Miss A" labels are deliberate — Kade's call, real first name
// stays out of the picker.
const FISH_NAMED_LABELS = {
  "Voice 327": "Kade calm and casual",
  "Voice 385": "Miss A Irish",
  "Voice 391": "Miss A animated conversation",
  "Voice 393": "Miss A pro reading",
  "Voice 424": "Kade's child impression",
  "Voice 463": "Miss A casual",
  "Voice 464": "Kade conversational",
  "Voice 466": "Kade Candid",
};
const FISH_VOICE_ADDITIONS_2026_07_22 = {
  "Voice 327": "fish:05d77f76cf30488eaa27588e34e57dda", // Me as a Calm Inspirational Narrator
  "Voice 328": "fish:0d5c43d170ab4fefa7408867cfd29de3", // Monstertruck synthwoman
  "Voice 329": "fish:ffd42497a4cb4fd88a0279bf29c4a5cc", // Shy teacher synthwoman
  "Voice 330": "fish:730b6b37d47648c995e1825500daa60a", // Crazy KG teacher synthwoman
  "Voice 331": "fish:cbe91ef2f4c24da286801efecc1f3890", // Toaster2 synthman
  "Voice 332": "fish:ac66b73cb77f4060abb4393cdbb12a24", // Toaster synthman
  "Voice 333": "fish:bbbb0e9369a9426a8afdb033c90ecc79", // Car-guy synthman
  "Voice 334": "fish:8f6151a6e0fa4ea1b213670e090508c6", // Synico Synthman
  "Voice 335": "fish:0f03b64528e74c69aea012c3fe8a563f", // Southern nansy synthwoman
  "Voice 336": "fish:8ae5c998cc5b473da03e0667224abe24", // Mad granny synthwoman
  "Voice 337": "fish:c68ed04e686c40378bca163a57904c59", // Southern granny Synthwoman
  "Voice 338": "fish:371a6ca8841c4bcebcad0dc9d2e3d159", // Tired flight attendant synthwoman
  "Voice 339": "fish:f6d6c62137e54960b09f5c3bf8da4cc7", // Auctioneer synthman
  "Voice 340": "fish:8a5aeabe1b2c47b7b429fe719ce6b406", // Planty synthman
  "Voice 341": "fish:2d7d5455c8794a6f803ef577b804e22d", // Evil support synthman
  "Voice 342": "fish:74522d3f60d44e8ba34ebf9e1b979cb1", // Shopping-host synthwoman
  "Voice 343": "fish:e6c6631582194387a4e1fea6351e476b", // Water-guy synthman
  "Voice 344": "fish:163096188b924ece8c71eca68fdc4084", // Nature-brit synthman
  "Voice 345": "fish:ea710301cfd64ccfa835a314f022bc40", // Preacher synthman
  "Voice 346": "fish:2291429b372d4d2c9886af71b29e5d88", // Preacher synthwoman
  "Voice 347": "fish:be0f351c4f6b448b85e0e7784592fa76", // Southern preacher synthwoman
  "Voice 348": "fish:1a09613c3b954d6ebbd5bd497cfefcab", // Southern preacher synthman
  "Voice 349": "fish:d7695f2b7cab4869bcb1aa8fc623ba9e", // Evil scientist Synthman
  "Voice 350": "fish:7b14ff9b6b3f41e18228498f79294ba7", // Nutso Synthman
  "Voice 351": "fish:6556eebbf6d0428f87579ff03608aee2", // Barker synthman
  "Voice 352": "fish:f23a98b8265e40c3857d0b52473e6914", // Tough-tex Synthman
  "Voice 353": "fish:cb96c4b8e2234585b7748dde366ea6f7", // Ausie Synthman
  "Voice 354": "fish:f9483be29e244b5aae25a172ed3af00c", // Untruthful narrator
  "Voice 355": "fish:0c753c02d2f146eebcd5efcaeb40e678", // Creepy latenight dj
  "Voice 356": "fish:bc0600808443478e9a97f98c19f11c36", // Ozark-grand synthman
  "Voice 357": "fish:aa81cb78ba154b3d81faf2e5a68a8c98", // Copper synthman
  "Voice 358": "fish:b34f6d46d6134e888df4b616f4fe0c1e", // Jockman synthteen
  "Voice 359": "fish:edac64c14cb1431598d6e4730a0fc535", // Mean-girl synthteen
  "Voice 360": "fish:320e581db28948a69d248b9a3d06a9d2", // Game-guy synthman
  "Voice 361": "fish:8f0b374a76264f13860a84376f75b7aa", // Male-nerd synth-teen
  "Voice 362": "fish:17189e9cf988441a9be6b459a450e25d", // Tough-girl synthteen
  "Voice 363": "fish:c9eca4b3949347828b362f856df487bb", // Skater dude synthteen
  "Voice 364": "fish:72943a366dad4cec874542efbdf17366", // Emo Synthteen
  "Voice 365": "fish:5c2ca48e600c4250ada20fa8c292c887", // Teena synthteen
  "Voice 366": "fish:204bd3857db64c8f95369ddbda029d9f", // Brattley
  "Voice 367": "fish:4241821fa1b34d24b532f6acbdaf892d", // Marivia synthchild
  "Voice 368": "fish:3bd0de2117d2478fb42f48c0852d8885", // Natasha, female black teen
  "Voice 369": "fish:2036021eea1d42a1ac155e269f672022", // New york male Energetic Sales Voice
  "Voice 370": "fish:bf1f58af2f58488cb8bb45f47fb76abf", // Female preschool Lively Event Host
  "Voice 371": "fish:5c1143082e2940cca5d99b1113d5e8e0", // Ren, Clear Young Narrator
  "Voice 372": "fish:fcd46f07b87141eab97ca1fd0c726315", // Retro strict female teacher
  "Voice 373": "fish:47d3c1ef3a7144a493f38fc8795bf9ef", // Scarla female commercial child
  "Voice 374": "fish:4663d335217943adacee8d6824d9adb2", // Worried woman2
  "Voice 375": "fish:a998d03622ff43cfa7744ab3f500188c", // Southern used car guy
  "Voice 376": "fish:cbb42be17ff44ef4ae61cf40a7f10f88", // Silvia, female child
  "Voice 377": "fish:17079d6adb8b4ecc8e42c8e6f489492b", // Chill southern child
  "Voice 378": "fish:63cabe52529c43c6a317d33b5a395cb6", // Snarky woman
  "Voice 379": "fish:f61abb22f0c64fb79f6df982257ba078", // The cutest synth child
  "Voice 380": "fish:54b0e05f6514475f846d9eba28c6dabb", // Child with unknown accent
  "Voice 381": "fish:e05e7322fff046f5bfe9105140bc1dfd", // Vintage stranger danger guy
  "Voice 382": "fish:185c72f02da24dad839711440a903a8c", // Old guy speech 2
  "Voice 383": "fish:31e064eae4654f2c93656398b63965bb", // Natia
  "Voice 384": "fish:5f87372b8739431187665ea33d1fcdba", // DJ velvet
  "Voice 385": "fish:699eff962b0f4b0e98361bb86dcb4c42", // Amber Irish
  "Voice 386": "fish:c51bca316d3c4bb68964d704153fc41d", // Honey synth child
  "Voice 387": "fish:1085c78885e945c9a69b4cea4ffe87b4", // Cody synth child
  "Voice 388": "fish:bf629aae231440b3bc341e00d2825cdd", // black synth child
  "Voice 389": "fish:016b2a32f30c4f1fa48ffae2c6c5b560", // Synth child2
  "Voice 390": "fish:517a0b184b9340fb9a388f8a9d0e1277", // Synth child
  "Voice 391": "fish:8905624ef97b4adaa4b3cd821b567273", // Amber animated conversation
  "Voice 392": "fish:b6fc3c185a7740379e6b95a171c18cf9", // Hannah the valley child
  "Voice 393": "fish:335c58e39d904ef6ae9d5647ce10499e", // Pro amber reading
  "Voice 394": "fish:000c81f95f0543b2abb8e368286bb393", // Ned
  "Voice 395": "fish:056710137531402ea15afdddffcd86bd", // Ethan
  "Voice 396": "fish:c4e1ba0562fa4dbe963bd43751852c17", // Paul
  "Voice 397": "fish:ede205f29cc145a19844cd96c4899325", // Doc
  "Voice 398": "fish:4a7dedfab6eb4906b8b70546ab0edd38", // Jason
  "Voice 399": "fish:1263e0486bdc4fef8aaacb84020e7da6", // Raspia
  "Voice 400": "fish:5f02b4d58dbc46178013a5e405ae4cf5", // Miriam
  "Voice 401": "fish:75adee2586d64c4cb3dde0b284ccca7d", // Vadalia
  "Voice 402": "fish:49ad7230fdb34ed1ba1b9fa93ae09e6a", // Courtland
  "Voice 403": "fish:33a485a85eef46f88a013782ddc3f1af", // Maurilla
  "Voice 404": "fish:220f311e4ad2498d9082983781be6248", // Maira
  "Voice 405": "fish:f8adaa93e2944d4baeb62b93f4e3b277", // Yorkley
  "Voice 406": "fish:22005cd910e6415e87221ce019716a73", // Kristy
  "Voice 407": "fish:ae88891688d84cb1946bfd77c5e5a09a", // Judith
  "Voice 408": "fish:67022a3dfed64a90bb1e1df67f77461c", // Malla
  "Voice 409": "fish:22476e18ca6340e790869836d86a9bef", // Marryanne
  "Voice 410": "fish:5e0fdd15a74147edbda0efde30cc92fe", // Sassy
  "Voice 411": "fish:0fac1b9df2694c3082fca7c5d7300ce6", // Danielle
  "Voice 412": "fish:32060217a430401dbe54a2469dbf4daa", // Amanda
  "Voice 413": "fish:adf18a7fcaae4e1d86fd1ab2dea771ac", // Tammy  synthetic
  "Voice 414": "fish:8f9ee666a57f4f3faa4363a1a3d3be27", // Valley girl 3
  "Voice 415": "fish:72675cd9e42b44d0baa856e3c36446ce", // Krista synthetic
  "Voice 416": "fish:a5e4afcd6c1d4e92a441640933536021", // Ashley
  "Voice 417": "fish:e3435b56b4804fd081d73bcc1abcee79", // Fake Francene synthetic
  "Voice 418": "fish:7325a072283b47a8949c696426ca8f10", // Valley girl2 synthetic
  "Voice 419": "fish:0e1e4b07242045da99658bd1a674e7d3", // Valley girl1
  "Voice 420": "fish:f42c0907ab9d458f970747c05b059e5b", // Sappy sammy synthetic
  "Voice 421": "fish:1eb6e04c3b82467eab86cc1df7917ef3", // Ethrage
  "Voice 422": "fish:76b9497d4abd49f9a1f454f8fa66a84e", // Rocky synthetic
  "Voice 423": "fish:712ce58fbaf14952a2d2154827b894f8", // Yawning clown synthetic
  "Voice 424": "fish:e019ab27027445f2a74a53067986030b", // Me child voice actor
  "Voice 425": "fish:a4b3520cc73646199435d741de67d2ac", // Black teen narrator
  "Voice 426": "fish:c685fed26d134dbb8933f55cc25ee6a2", // Cassia synthetic
  "Voice 427": "fish:976cedd320f846fb98d542eac4935f11", // Mandi synthetic
  "Voice 428": "fish:6c22a8d8a5cb4e0c9fa68a555512de46", // Elly May synthetic child
  "Voice 429": "fish:008e29be7aa644e38e1dddabe69f34eb", // Sargeant synthetic
  "Voice 430": "fish:0aac6ce23bd047dcb128990bdd985354", // Boss synthetic
  "Voice 431": "fish:47489804822a4a1e96ff3097a6b54517", // Female Rev synthetic
  "Voice 432": "fish:563f216353f34a7c928864e6631209bb", // Mob girl synthetic
  "Voice 433": "fish:93fcaf07806c46758a23c6c814cd103a", // Jayda synthetic
  "Voice 434": "fish:8c9ff80d60c2476b82a3194756985983", // CB trucker synthetic
  "Voice 435": "fish:18a29126b2444525a96f4942466c305b", // Vintage gameshow host synthetic
  "Voice 436": "fish:9b4d1d84549142c585ac9d4df8401304", // Sarina urban narrator synthetic
  "Voice 437": "fish:dc3d71e00c1349fcad59e423eb8e6d13", // Scary aunt synthetic
  "Voice 438": "fish:c708e45bfcf04b318cce053821dc2668", // Shocked Stephen synthetic
  "Voice 439": "fish:2c9347b0f4d74aa29031bbbece941923", // Scary narrator1 synthetic
  "Voice 440": "fish:777466d7710f4f79b41b49088d3851d4", // Ducky mcquackerson synthetic
  "Voice 441": "fish:d2e2edb3b2f040008141793fdf4e7221", // Pukin reporter
  "Voice 442": "fish:76b24095b38944c29e24b60bdf0f19e9", // Preacher male synthetic
  "Voice 443": "fish:e391b5994c884a4d9603947ff81469cd", // Death metal devil
  "Voice 444": "fish:e54b8c9561f74fa4acb042de28a454a0", // Old brit
  "Voice 445": "fish:cf84ba23fa1044fca234d3ce3d64c461", // Nova Synthetic
  "Voice 446": "fish:6da52d3ae05849eb9e83d0ac48c9ef8e", // Lilia synthetic
  "Voice 447": "fish:64ce619ce6be47feba34bc7a34921a28", // Libby Synthetic
  "Voice 448": "fish:1162eab1c2b44c6185d262e0334762ad", // Jamaiken granny
  "Voice 449": "fish:df3096e17a3549de8be3cae0b969d93e", // Kyla Synthetic
  "Voice 450": "fish:191ffc79b6784201b28211ee9703662d", // Kathlene synthetic
  "Voice 451": "fish:73c27cf03e9c4399ac6dec38e59ef4d0", // Angel Synthetic
  "Voice 452": "fish:f80c4d2d57a54498a82d4ce8addfa7c9", // Hiphop male 1 synthetic
  "Voice 453": "fish:21bdcfe750824e62b0d2fa88e468c195", // Southern Granny synthetic
  "Voice 454": "fish:a45899dd3a854410b9a2d78a902e7834", // Drunk sounding old man on the phone synthetic
  "Voice 455": "fish:392292d274054bf89affc0173eea377b", // Depressed hipster
  "Voice 456": "fish:e3abbbaef28a414ba50fbb634956900b", // Colbie synthetic
  "Voice 457": "fish:e5bf590282c342818e97f479708f9b40", // Cartoonia Synthetic
  "Voice 458": "fish:b6ecc06c7efa46ff964d7607231cf6ab", // Alegra synthetic
  "Voice 459": "fish:98b45cf162ea4fec9674cdfe127c7fda", // Samaria
  "Voice 460": "fish:f50747df0da34c4f9d4b4b5e0dc4cf9f", // Monique synthetic
  "Voice 461": "fish:5255be4011ec404ab80e5716f2583bf8", // Kid mya, synthetic
  "Voice 462": "fish:810855eb85924765b66b8b198d47ee78", // Deej
  "Voice 463": "fish:21197f5e2e5f42cfb5846fcf7bc3734b", // Amber casual
  "Voice 464": "fish:00644e8178f044f7a77891ef9b629b56", // Me casual
  "Voice 465": "fish:3bf859ed5bca442ebc2ee4f146dbf742", // Emani
  "Voice 466": "fish:87c5186b618e40f5a0f96e7fc37e6ed5", // Me talking casually
  "Voice 467": "fish:cf8bfba715f74cd7a48da7cc346f3436", // Shaina
  "Voice 468": "fish:d5abd19ff43a4f838a48e75da9edb4f8", // Kiddy
};
{
  const addLabels = Object.keys(FISH_VOICE_ADDITIONS_2026_07_22);
  if (addLabels.length !== 142) throw new Error(`fish additions: expected 142, got ${addLabels.length}`);
  const displayOf = (label) => {
    const named = FISH_NAMED_LABELS[label];
    return `${label}${named ? " " + named : ""}`; // beta graduated July 23 2026
  };
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${327 + idx}`) throw new Error(`fish additions: non-contiguous at ${label}`);
    const target = FISH_VOICE_ADDITIONS_2026_07_22[label];
    if (!target.startsWith(FISH_VOICE_PREFIX)) throw new Error(`fish additions: ${label} is not a fish: target`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`fish additions: ${label} collides with an existing alias`);
    NUMBERED_VOICE_ALIASES[label] = target; // bare number: spoken switching + integrity check
    VOICE_MAP[label] = target;              // (VOICE_MAP spread-snapshot gotcha — must be explicit)
    const display = displayOf(label);
    VOICE_MAP[display] = target;            // named form resolves forever (stored selections)
    // Aug 6 2026 (Kade: "take the names off the voices. They should be
    // numbered only") — the picker lists the bare number; the named display
    // string lives on as a hidden alias so nothing anyone saved ever breaks.
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
    if (display !== label) HIDDEN_VOICE_ALIASES.push(display);
    // Old beta-era spellings: hidden aliases forever (see comment above).
    const named = FISH_NAMED_LABELS[label];
    const oldBare = `${label} (Beta)`;
    VOICE_MAP[oldBare] = target;
    HIDDEN_VOICE_ALIASES.push(oldBare);
    if (named) {
      const oldNamed = `${label} (Beta) ${named}`;
      VOICE_MAP[oldNamed] = target;
      HIDDEN_VOICE_ALIASES.push(oldNamed);
      // The NAMED eight's list entry is "Voice N <name>", but a stored pick
      // may be the bare "Voice N" (the July 22 sweep wrote bare numbers, and
      // spoken switching produces them too). The proxy has always resolved
      // the bare key (NUMBERED_VOICE_ALIASES); publishing it as hidden means
      // the fork's validators accept it instead of bouncing a valid label.
      HIDDEN_VOICE_ALIASES.push(label);
    }
  });
  // RETIRED July 22 2026, same night it shipped (Kade: "voices from fish are
  // on top of the old ones, and the numbering looks weird that way"): the
  // flagship-first prepend that moved "Voice 327 (Beta) …" to index 0. The
  // list now stays in natural ascending order, 1 through 468, fish block
  // after the classics exactly where its numbers say it lives. Her clone is
  // still first OF THE BETAS and one search away. (The fork's picker sort
  // was also made suffix-tolerant the same night — fork commit alongside
  // this one — so display order no longer depends on this array's order,
  // but hash-assigned fallback voices DO index into this array raw: keep it
  // append-only and ascending, never decorative-reordered again.)
}

// ── 2026-07-23 FISH ADDITIONS (Kade added 7 new clones to her fish.audio
// library the same day beta graduated: "I added a few fish audio voices to my
// collection can you add them... Just the ones I made today only"). Pulled
// live from api.fish.audio (created_at 2026-07-23, cross-checked against
// every fish: id already registered — zero overlap with the July 22 wave).
// APPEND-ONLY as Voice 469+, plain labels (no beta — that era is over), no
// named labels (their fish titles are generic, not her personal-clone names).
const FISH_VOICE_ADDITIONS_2026_07_23 = {
  "Voice 469": "fish:8bf0de5cad3e4b78a9988d9d54beea92", // Tiana
  "Voice 470": "fish:e5974a7357834075a9f0277305a393df", // Playful Narrator
  "Voice 471": "fish:869c973342d54ff7bbb494c6fd3d1c92", // Friendly Young Storyteller
  "Voice 472": "fish:4f65dbc86cdb4187b31b6c6c49da1b1f", // Good Vibes Female
  "Voice 473": "fish:dc2b954e85094e3997de914dd17776ff", // Casual Young Speaker
  "Voice 474": "fish:614fcba09e104d73be283beb901451cc", // Calm Young Woman
  "Voice 475": "fish:044d4c660a444bd9b1a8523db49b1ab0", // Smooth Soulful Male
};
{
  const addLabels = Object.keys(FISH_VOICE_ADDITIONS_2026_07_23);
  if (addLabels.length !== 7) throw new Error(`fish additions 07-23: expected 7, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${469 + idx}`) throw new Error(`fish additions 07-23: non-contiguous at ${label}`);
    const target = FISH_VOICE_ADDITIONS_2026_07_23[label];
    if (!target.startsWith(FISH_VOICE_PREFIX)) throw new Error(`fish additions 07-23: ${label} is not a fish: target`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`fish additions 07-23: ${label} collides with an existing alias`);
    NUMBERED_VOICE_ALIASES[label] = target;
    VOICE_MAP[label] = target; // (VOICE_MAP spread-snapshot gotcha — must be explicit)
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-08-03 INWORLD VOICE ADDITIONS (Kade: "I have new voices on inworld
// and fish audio that I need you to add to the catalog"). Pulled live from
// api.inworld.ai/tts/v1/voices and diffed against every registered custom id —
// these 3 are the only non-personal customs not yet registered (a live re-diff
// caught that the other design voices from the account were ALREADY live —
// Detective=228, Misty=38, bex=216, mac=260, the two Tasha Wexlers=61/62 etc). The
// personal-clone hold-outs (Kade*, Amber*/Miss A, Sky, Dale, Keighty, Podcast
// Keighty fast) remain OUT per her standing vet, reconfirmed by her today
// ("don't add any of the inworld or fish voices I've said not to add in the
// past"). APPEND-ONLY as Voice 476+; same boot-crash rails as prior blocks.
const VOICE_ADDITIONS_2026_08_03 = {
  "Voice 476": "default-e-m11vgtr9l-m7afw4kmnw__design-voice-63dc415d", // Naisha
  "Voice 477": "default-e-m11vgtr9l-m7afw4kmnw__brooke", // brooke
  "Voice 478": "default-e-m11vgtr9l-m7afw4kmnw__raven", // Raven
};
{
  const addLabels = Object.keys(VOICE_ADDITIONS_2026_08_03);
  if (addLabels.length !== 3) throw new Error(`voice additions 08-03: expected 3, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${476 + idx}`) throw new Error(`voice additions 08-03: non-contiguous at ${label}`);
    const target = VOICE_ADDITIONS_2026_08_03[label];
    if (!target.startsWith("default-e-")) throw new Error(`voice additions 08-03: ${label} not a custom id`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`voice additions 08-03: ${label} collides`);
    NUMBERED_VOICE_ALIASES[label] = target;
    VOICE_MAP[label] = target; // (VOICE_MAP spread-snapshot gotcha — must be explicit)
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-08-03 FISH ADDITIONS (same session): her 15 designed clones from
// July 24 plus all 35 she made today, pulled live from api.fish.audio and
// cross-checked against every registered fish: id. The 53 clones she left
// OUT at the July 22 supervised pick (Lacey, the old personal full-clones,
// and the rest) STAY out — none of them are in this block. APPEND-ONLY as
// Voice 493+, plain labels (no display names — titles are designed/generic).
const FISH_VOICE_ADDITIONS_2026_08_03 = {
  "Voice 479": "fish:cd40d8b325474589b06448f84499f8f4", // Relaxed Vibe Narrator
  "Voice 480": "fish:f08106e8a65a409ab55ae98c04832662", // Youthful Reflective Voice
  "Voice 481": "fish:69818565c43f40bd908ad0e55812d635", // Relaxed Young Female
  "Voice 482": "fish:7bc01f7f1f714c1ca8b6c9fb25217b1a", // Authentic Young Female
  "Voice 483": "fish:1993c52eaab14015a4038b7491cea8f4", // Lively Storyteller
  "Voice 484": "fish:2faaa103181942249f9887ce0678103a", // Relaxed Young Female (second take)
  "Voice 485": "fish:d9aa89060a2447e98338b7ba01b9f3ac", // Playful Young Voice
  "Voice 486": "fish:73e2a035db5741568ac173a07d473ee0", // Playful Young Voice (second take)
  "Voice 487": "fish:2b69712dd93e42bca0825a511904ce2a", // Casual Young Speaker
  "Voice 488": "fish:bccb6c18b16646afaab3adb2d12d86ca", // Animated Young Female
  "Voice 489": "fish:33c7a9bd372a4ccfae3d8b3ece4fdaf9", // Friendly Southern Narrator
  "Voice 490": "fish:dafacaa7fe3341fbaf7daed65f97ddd9", // Casual Male Storyteller
  "Voice 491": "fish:f7b2ec59022244dcaafc709b2ada1dd6", // Friendly Missouri Voice
  "Voice 492": "fish:d89c5cc8e70b45d1b60053c12a13f6df", // Friendly Town Narrator
  "Voice 493": "fish:3ef2e6b2b6d6488e89a2e6b82bfca346", // Friendly Local Voice
  "Voice 494": "fish:1becffd505cf45e885976ce56c28af33", // Martayah
  "Voice 495": "fish:6c4ddee6dc3a43118a980cfad35320ae", // Southern belle
  "Voice 496": "fish:4e284a69fb0044ffa96fb32187b6896c", // Dola
  "Voice 497": "fish:e5e85c45d0dc456384c62e9183341dae", // Whitney
  "Voice 498": "fish:f461e09069394ecda51bf6334b71b316", // Daymond
  "Voice 499": "fish:59c167219b0c4fceb15d7dee303bb00f", // Teefa
  "Voice 500": "fish:1224cf0ae854460fbc792513c113f957", // Beautisha
  "Voice 501": "fish:35219ffb4c584b939e54a9e89982f319", // Jordman
  "Voice 502": "fish:8ae99548f39347bd9df47cd3363fa039", // Birtha
  "Voice 503": "fish:6a9e7cbc9fc34ea5bae78000cebc3989", // Monique (new clone; Voice 460 is the older Monique synthetic)
  "Voice 504": "fish:f6fd57afe2ad493cb10e92873c173ed8", // Nerdy nancy
  "Voice 505": "fish:8f432247ef6f4e69a74d00472a14c0b0", // derna
  "Voice 506": "fish:882ceebd885349b297c10c5d70809d6a", // Pam
  "Voice 507": "fish:137f1ace2f13498abce503f52f8cf7f7", // Dezzarae
  "Voice 508": "fish:33af52a8a70f49d282a3d366a1b14bc9", // Tasha
  "Voice 509": "fish:8867d5fc32cf4f1593ffeca331e64d21", // Chadley
  "Voice 510": "fish:753252a2e730413b95f233182caf4b52", // Ken
  "Voice 511": "fish:c2810ae2ca5d47ef970bdab323de5595", // Fran
  "Voice 512": "fish:7a17558792884653adabc6e6e4b3c491", // Scottsley
  "Voice 513": "fish:0df87b91f70c42e4a1499a61e314d299", // Lil boy
  "Voice 514": "fish:658b358662844f0190d3671bc1bf8d66", // Spineta
  "Voice 515": "fish:a04e79b3003a4f01ae26b330a441862c", // Whyrana
  "Voice 516": "fish:e772c2e1b76a4426adfaeb2eeb63974f", // Zanique
  "Voice 517": "fish:9d51021e271b468094df7d0a053b281d", // Kyra
  "Voice 518": "fish:05ae62dda1aa49b395b86d1841fb09c9", // Sharey
  "Voice 519": "fish:0bce010bd51a4fd790ce50f86296f7aa", // Sondra
  "Voice 520": "fish:4145214bc6374d8883fea7a8914c5876", // Cookie
  "Voice 521": "fish:4d12380d8227402493b62f8232353e41", // Brentlyn
  "Voice 522": "fish:b83b4fed33b44978ac477c669a759e27", // Daynah
  "Voice 523": "fish:64cc2eede5494d998834910cc2aad23a", // Earlman
  "Voice 524": "fish:9ed13f467ce14ef0b025fef7575ceba8", // Marondro
  "Voice 525": "fish:265eabb66c8f4ef0aa8b6e5d2be5535e", // Tanayah
  "Voice 526": "fish:6c7b6688018347b2ba7777788b2bb912", // Moxxi
  "Voice 527": "fish:3ba3f3354b614dc99bc90c3cc975e254", // Brenton
  "Voice 528": "fish:0e21e15778dd40318803c412ca7db5e3", // Lillian
};
{
  const addLabels = Object.keys(FISH_VOICE_ADDITIONS_2026_08_03);
  if (addLabels.length !== 50) throw new Error(`fish additions 08-03: expected 50, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${479 + idx}`) throw new Error(`fish additions 08-03: non-contiguous at ${label}`);
    const target = FISH_VOICE_ADDITIONS_2026_08_03[label];
    if (!target.startsWith(FISH_VOICE_PREFIX)) throw new Error(`fish additions 08-03: ${label} is not a fish: target`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`fish additions 08-03: ${label} collides`);
    NUMBERED_VOICE_ALIASES[label] = target;
    VOICE_MAP[label] = target; // (VOICE_MAP spread-snapshot gotcha — must be explicit)
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-08-04 INWORLD VOICE ADDITIONS (Kade: "I just added a few new voices
// to inworld, can you add them"). Pulled live from api.inworld.ai and diffed
// against every registered custom id — these 8 are the new NON-personal voices
// (real names, not clones). Her personal clone hold-outs (Kade*, Amber*/Miss A,
// Keighty*, Sky, Dale, Podcast Keighty fast) remain OUT per her standing vet.
// APPEND-ONLY as Voice 529+; same boot-crash rails as every prior block.
const VOICE_ADDITIONS_2026_08_04 = {
  "Voice 529": "default-e-m11vgtr9l-m7afw4kmnw__raiche", // Raiche
  "Voice 530": "default-e-m11vgtr9l-m7afw4kmnw__kandi", // Kandi
  "Voice 531": "default-e-m11vgtr9l-m7afw4kmnw__maliah", // Maliah
  "Voice 532": "default-e-m11vgtr9l-m7afw4kmnw__trayvan", // Trayvan
  "Voice 533": "default-e-m11vgtr9l-m7afw4kmnw__fabricia", // Fabricia
  "Voice 534": "default-e-m11vgtr9l-m7afw4kmnw__toyabelle", // Toyabelle
  "Voice 535": "default-e-m11vgtr9l-m7afw4kmnw__darce", // Darce
  "Voice 536": "default-e-m11vgtr9l-m7afw4kmnw__nivea", // Nivea
};
{
  const addLabels = Object.keys(VOICE_ADDITIONS_2026_08_04);
  if (addLabels.length !== 8) throw new Error(`voice additions 08-04: expected 8, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${529 + idx}`) throw new Error(`voice additions 08-04: non-contiguous at ${label}`);
    const target = VOICE_ADDITIONS_2026_08_04[label];
    if (!target.startsWith("default-e-")) throw new Error(`voice additions 08-04: ${label} not a custom id`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`voice additions 08-04: ${label} collides`);
    NUMBERED_VOICE_ALIASES[label] = target;
    VOICE_MAP[label] = target; // (VOICE_MAP spread-snapshot gotcha — must be explicit)
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-08-04 FISH ADDITIONS (Kade: "I added some to fish audio can you add
// them too?"). Pulled live from api.fish.audio, created_at 2026-08-04 — the 4
// new designed voices she made today. Cross-checked: zero overlap with any
// registered fish: id. The 53 older unregistered clones (Lacey + the personal
// Kade/Amber/Keighty/Sky full-clones and the July-22 leave-outs) STAY out per
// her standing pick. APPEND-ONLY as Voice 537+.
const FISH_VOICE_ADDITIONS_2026_08_04 = {
  "Voice 537": "fish:a8f5aaf5195b44c8970f888a36f477f8", // Authentic Young Woman
  "Voice 538": "fish:d53b913f611c4574b01194c11dbeb58e", // Warm Confidante
  "Voice 539": "fish:656e669b40a64e058e5244b63fdf1a33", // Empathetic Young Woman
  "Voice 540": "fish:eaf7c0a753b145698c8e89b8aa823c7c", // Empathetic Young Female
};
{
  const addLabels = Object.keys(FISH_VOICE_ADDITIONS_2026_08_04);
  if (addLabels.length !== 4) throw new Error(`fish additions 08-04: expected 4, got ${addLabels.length}`);
  addLabels.forEach((label, idx) => {
    if (label !== `Voice ${537 + idx}`) throw new Error(`fish additions 08-04: non-contiguous at ${label}`);
    const target = FISH_VOICE_ADDITIONS_2026_08_04[label];
    if (!target.startsWith(FISH_VOICE_PREFIX)) throw new Error(`fish additions 08-04: ${label} is not a fish: target`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`fish additions 08-04: ${label} collides`);
    NUMBERED_VOICE_ALIASES[label] = target;
    VOICE_MAP[label] = target; // (VOICE_MAP spread-snapshot gotcha — must be explicit)
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
  });
}

// ── 2026-08-04 KADE PROFESSIONAL SELF-CLONE (Kade: "there are one or 2
// professional voice clones on inworld of me I'd like to add." She picked the
// 'Keighty pro' inworld clone, labeled under the 'Kade' brand to keep her real
// first name out of the picker — same privacy rule as the 'Miss A' labels.)
// APPEND-ONLY as Voice 541, NAMED: bare "Voice 541" + display "Voice 541 Kade
// professional" both resolve (same pattern as the fish named labels above).
const KADE_PRO_ADDITION_2026_08_04 = {
  "Voice 541": { target: "default-e-m11vgtr9l-m7afw4kmnw__keighty_pro", name: "Kade professional" },
};
{
  const entries = Object.entries(KADE_PRO_ADDITION_2026_08_04);
  if (entries.length !== 1) throw new Error(`kade pro: expected 1, got ${entries.length}`);
  for (const [label, info] of entries) {
    if (!/^Voice \d+$/.test(label)) throw new Error(`kade pro: bad label ${label}`);
    if (!info.target.startsWith("default-e-")) throw new Error(`kade pro: ${label} not a custom id`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`kade pro: ${label} collides`);
    const display = `${label} ${info.name}`;
    NUMBERED_VOICE_ALIASES[label] = info.target; // bare: spoken switching + integrity check
    VOICE_MAP[label] = info.target;
    VOICE_MAP[display] = info.target;            // named form resolves forever (stored selections)
    // Aug 6 2026: numbered-only picker (her ask) — bare label listed, named
    // display demoted to hidden alias.
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
    HIDDEN_VOICE_ALIASES.push(display);
  }
}

// ── 2026-08-06 VOICE ADDITIONS (Kade: "I have new voices on fish audio and
// inworld. Can you add them?"). Live-diffed both providers against every
// registered id. NEW since the Aug-3 sweep: six inworld workspace clones
// (family names — none on her standing hold-out vet) + five fish clones
// created the same night. Kayshia/Doachah/Londranno exist on BOTH providers
// (her side-by-side comparison pattern) — the fish twins carry a " fish"
// suffix so spoken switching stays unambiguous. THE HOLD-OUTS (Kade*,
// Amber*/Miss A, Sky, Dale, Keighty, Podcast Keighty fast) REMAIN OUT per
// her standing vet, reconfirmed Aug 3 — only "Kade professional" (541) has
// ever been individually invited. APPEND-ONLY as Voice 542+; same
// boot-crash rails as prior blocks.
const VOICE_ADDITIONS_2026_08_06 = {
  "Voice 542": { target: "default-e-m11vgtr9l-m7afw4kmnw__kayshia", name: "Kayshia" },
  "Voice 543": { target: "default-e-m11vgtr9l-m7afw4kmnw__chancey", name: "Chancey" },
  "Voice 544": { target: "default-e-m11vgtr9l-m7afw4kmnw__nashay", name: "Nashay" },
  "Voice 545": { target: "default-e-m11vgtr9l-m7afw4kmnw__puddin", name: "Puddin" },
  "Voice 546": { target: "default-e-m11vgtr9l-m7afw4kmnw__doachah", name: "Doachah" },
  "Voice 547": { target: "default-e-m11vgtr9l-m7afw4kmnw__londranno", name: "Londranno" },
  "Voice 548": { target: "fish:1e70a5539a8e495eadfce5fff533f08f", name: "Kayshia fish" },
  "Voice 549": { target: "fish:1fc3e2fea4034ebf9a49132d390008d7", name: "Doachah fish" },
  "Voice 550": { target: "fish:25644d4b4f6c42c49694323accb2a952", name: "Londranno fish" },
  "Voice 551": { target: "fish:6b040e42410740e49c31aa1d0088c8a5", name: "Supportive Friend" },
  "Voice 552": { target: "fish:d9a9b510642f41e49086b8f17e08851c", name: "Friendly Young Female" },
};
{
  const entries = Object.entries(VOICE_ADDITIONS_2026_08_06);
  if (entries.length !== 11) throw new Error(`additions 08-06: expected 11, got ${entries.length}`);
  entries.forEach(([label, info], idx) => {
    if (label !== `Voice ${542 + idx}`) throw new Error(`additions 08-06: non-contiguous at ${label}`);
    const okTarget = info.target.startsWith("default-e-") || info.target.startsWith("fish:");
    if (!okTarget) throw new Error(`additions 08-06: ${label} target shape`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`additions 08-06: ${label} collides`);
    const display = `${label} ${info.name}`;
    NUMBERED_VOICE_ALIASES[label] = info.target;
    VOICE_MAP[label] = info.target;
    VOICE_MAP[display] = info.target;            // named form resolves forever
    // Aug 6 2026: numbered-only picker (her ask) — bare label listed, named
    // display demoted to hidden alias.
    VOICE_LIST.push(label);
    CUSTOM_VOICE_NUMBERS.add(label);
    HIDDEN_VOICE_ALIASES.push(display);
  });
}

// ── 2026-08-06 LATE ADDITIONS (Kade: "Just added a couple more voices to
// inworld for you to include."). Six new workspace clones since the evening
// sweep (workspace count 223 -> 229, exact match). Numbered-only displays per
// her same-night rule; names live here and in the catalog only. Hold-outs
// unchanged (17 still parked per her standing vet).
const VOICE_ADDITIONS_2026_08_06_LATE = {
  "Voice 553": { target: "default-e-m11vgtr9l-m7afw4kmnw__nayeema", name: "Nayeema" },
  "Voice 554": { target: "default-e-m11vgtr9l-m7afw4kmnw__soofy", name: "Soofy" },
  "Voice 555": { target: "default-e-m11vgtr9l-m7afw4kmnw__karma_rae", name: "Karma rae" },
  "Voice 556": { target: "default-e-m11vgtr9l-m7afw4kmnw__karreetha", name: "Karreetha" },
  "Voice 557": { target: "default-e-m11vgtr9l-m7afw4kmnw__synthetic_ki", name: "Synthetic Ki" },
  "Voice 558": { target: "default-e-m11vgtr9l-m7afw4kmnw__torana", name: "Torana" },
};
{
  const entries = Object.entries(VOICE_ADDITIONS_2026_08_06_LATE);
  if (entries.length !== 6) throw new Error(`late additions 08-06: expected 6, got ${entries.length}`);
  entries.forEach(([label, info], idx) => {
    if (label !== `Voice ${553 + idx}`) throw new Error(`late additions 08-06: non-contiguous at ${label}`);
    if (!info.target.startsWith("default-e-")) throw new Error(`late additions 08-06: ${label} target shape`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`late additions 08-06: ${label} collides`);
    const display = `${label} ${info.name}`;
    NUMBERED_VOICE_ALIASES[label] = info.target;
    VOICE_MAP[label] = info.target;
    VOICE_MAP[display] = info.target;            // named form resolves as a hidden alias only
    VOICE_LIST.push(label);                      // numbered-only picker (her rule)
    CUSTOM_VOICE_NUMBERS.add(label);
    HIDDEN_VOICE_ALIASES.push(display);
  });
}

// ── 2026-08-06 NIGHTCAP ADDITIONS (Kade: "Last task of the night. add the few
// new voices I just added to inworld."). Nine new workspace clones since batch
// two (workspace 229 -> 238, exact match). Numbered-only displays; hold-outs
// unchanged (17 parked).
const VOICE_ADDITIONS_2026_08_06_NIGHT = {
  "Voice 559": { target: "default-e-m11vgtr9l-m7afw4kmnw__traymon", name: "Traymon" },
  "Voice 560": { target: "default-e-m11vgtr9l-m7afw4kmnw__gianne", name: "Gianne" },
  "Voice 561": { target: "default-e-m11vgtr9l-m7afw4kmnw__lolo", name: "Lolo" },
  "Voice 562": { target: "default-e-m11vgtr9l-m7afw4kmnw__vennya", name: "Vennya" },
  "Voice 563": { target: "default-e-m11vgtr9l-m7afw4kmnw__magnolia", name: "Magnolia" },
  "Voice 564": { target: "default-e-m11vgtr9l-m7afw4kmnw__navita", name: "Navita" },
  "Voice 565": { target: "default-e-m11vgtr9l-m7afw4kmnw__nomi", name: "Nomi" },
  "Voice 566": { target: "default-e-m11vgtr9l-m7afw4kmnw__hailya", name: "Hailya" },
  "Voice 567": { target: "default-e-m11vgtr9l-m7afw4kmnw__diamond", name: "Diamond" },
};
{
  const entries = Object.entries(VOICE_ADDITIONS_2026_08_06_NIGHT);
  if (entries.length !== 9) throw new Error(`nightcap additions: expected 9, got ${entries.length}`);
  entries.forEach(([label, info], idx) => {
    if (label !== `Voice ${559 + idx}`) throw new Error(`nightcap additions: non-contiguous at ${label}`);
    if (!info.target.startsWith("default-e-")) throw new Error(`nightcap additions: ${label} target shape`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`nightcap additions: ${label} collides`);
    const display = `${label} ${info.name}`;
    NUMBERED_VOICE_ALIASES[label] = info.target;
    VOICE_MAP[label] = info.target;
    VOICE_MAP[display] = info.target;            // named form = hidden alias only
    VOICE_LIST.push(label);                      // numbered-only picker (her rule)
    CUSTOM_VOICE_NUMBERS.add(label);
    HIDDEN_VOICE_ALIASES.push(display);
  });
}

// ── 2026-08-06 FISH ADDITIONS, evening (Kade: "Add the new fish audio voices
// now."). Ten clones created this afternoon (17:10-18:27 UTC), oldest first.
// The 53 older unregistered fish stay skipped per her standing pick.
// Numbered-only displays; names live here and in the catalog.
const FISH_ADDITIONS_2026_08_06_EVE = {
  "Voice 568": { target: "fish:8efc1b81728a4a288541bbcc4851b0d2", name: "Bostonio" },
  "Voice 569": { target: "fish:ad6cf47c480042fba7542041c363f4a3", name: "Friendly Young Speaker" },
  "Voice 570": { target: "fish:c987a861142e493e8306f785e35ba4b5", name: "Friendly Young Voice" },
  "Voice 571": { target: "fish:1ac1f093b32746878906e832f4e6167f", name: "Friendly Youthful Voice" },
  "Voice 572": { target: "fish:d10d0aefa4004985885d6caa0d3c4aee", name: "Vennayah" },
  "Voice 573": { target: "fish:820fa315023845138d0493b444f14248", name: "Energetic Friend" },
  "Voice 574": { target: "fish:a4000529ceab4267873aa9c363bec5e6", name: "Energetic Young Speaker" },
  "Voice 575": { target: "fish:2f28159df6e4471db50127b6a52de6e2", name: "Laymarrah" },
  "Voice 576": { target: "fish:25f20fd9eac742f3b5a776567ce0927a", name: "Expressive Casual Male" },
  "Voice 577": { target: "fish:9da98880dbe24a3993787602bcbc9b43", name: "Friendly Young Male" },
};
{
  const entries = Object.entries(FISH_ADDITIONS_2026_08_06_EVE);
  if (entries.length !== 10) throw new Error(`fish eve additions: expected 10, got ${entries.length}`);
  entries.forEach(([label, info], idx) => {
    if (label !== `Voice ${568 + idx}`) throw new Error(`fish eve additions: non-contiguous at ${label}`);
    if (!info.target.startsWith("fish:")) throw new Error(`fish eve additions: ${label} target shape`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`fish eve additions: ${label} collides`);
    const display = `${label} ${info.name}`;
    NUMBERED_VOICE_ALIASES[label] = info.target;
    VOICE_MAP[label] = info.target;
    VOICE_MAP[display] = info.target;            // named form = hidden alias only
    VOICE_LIST.push(label);                      // numbered-only picker (her rule)
    CUSTOM_VOICE_NUMBERS.add(label);
    HIDDEN_VOICE_ALIASES.push(display);
  });
}

// ── 2026-08-06 INWORLD ADDITIONS, round four (Kade: "Add my new inworld
// voices to the catalogue"). 16 fresh workspace clones (workspace count
// 238→254; 33 unregistered found, 17 parked by her standing hold-out vet —
// incl. "Pro amber reading", an Amber the prefix check nearly missed).
// Numbered-only picker per her rule; names live here, in the hidden aliases,
// and in the catalog. Ear-described via the Gemini pipeline same session.
const VOICE_ADDITIONS_2026_08_06_EVE2 = {
  "Voice 578": { target: "default-e-m11vgtr9l-m7afw4kmnw__jadabell", name: "Jadabell" },
  "Voice 579": { target: "default-e-m11vgtr9l-m7afw4kmnw__snoley", name: "Snoley" },
  "Voice 580": { target: "default-e-m11vgtr9l-m7afw4kmnw__mobley", name: "Mobley" },
  "Voice 581": { target: "default-e-m11vgtr9l-m7afw4kmnw__lanore", name: "Lanore" },
  "Voice 582": { target: "default-e-m11vgtr9l-m7afw4kmnw__lorissa", name: "Lorissa" },
  "Voice 583": { target: "default-e-m11vgtr9l-m7afw4kmnw__mayflower", name: "Mayflower" },
  "Voice 584": { target: "default-e-m11vgtr9l-m7afw4kmnw__cooxy", name: "Cooxy" },
  "Voice 585": { target: "default-e-m11vgtr9l-m7afw4kmnw__ashe", name: "Ashe" },
  "Voice 586": { target: "default-e-m11vgtr9l-m7afw4kmnw__kellsey", name: "Kellsey" },
  "Voice 587": { target: "default-e-m11vgtr9l-m7afw4kmnw__casual_ki", name: "Casual Ki" },
  "Voice 588": { target: "default-e-m11vgtr9l-m7afw4kmnw__melody", name: "Melody" },
  "Voice 589": { target: "default-e-m11vgtr9l-m7afw4kmnw__sagen", name: "Sagen" },
  "Voice 590": { target: "default-e-m11vgtr9l-m7afw4kmnw__pebbsey", name: "Pebbsey" },
  "Voice 591": { target: "default-e-m11vgtr9l-m7afw4kmnw__bevvy", name: "Bevvy" },
  "Voice 592": { target: "default-e-m11vgtr9l-m7afw4kmnw__coco", name: "coco" },
  "Voice 593": { target: "default-e-m11vgtr9l-m7afw4kmnw__alissa", name: "Alissa" },
};
{
  const entries = Object.entries(VOICE_ADDITIONS_2026_08_06_EVE2);
  if (entries.length !== 16) throw new Error(`eve2 additions: expected 16, got ${entries.length}`);
  entries.forEach(([label, info], idx) => {
    if (label !== `Voice ${578 + idx}`) throw new Error(`eve2 additions: non-contiguous at ${label}`);
    if (!info.target.startsWith("default-e-")) throw new Error(`eve2 additions: ${label} target shape`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`eve2 additions: ${label} collides`);
    const display = `${label} ${info.name}`;
    NUMBERED_VOICE_ALIASES[label] = info.target;
    VOICE_MAP[label] = info.target;
    VOICE_MAP[display] = info.target;            // named form = hidden alias only
    VOICE_LIST.push(label);                      // numbered-only picker (her rule)
    CUSTOM_VOICE_NUMBERS.add(label);
    HIDDEN_VOICE_ALIASES.push(display);
  });
}

// ── 2026-08-19 INWORLD ADDITIONS (Kade: "Add the new inworld voices I just
// made ... taking care to not add the ones I left out before."). Pulled live
// from api.inworld.ai/tts/v1/voices (263 workspace customs) and diffed against
// all 237 registered ids: 26 unregistered, of which 17 are her standing
// personal-clone HOLD-OUTS kept OUT per her vet, reconfirmed this session —
// every Kade*/Amber*, Sky, Dale, Podcast Keighty fast, the sneaky
// pro_amber_reading, AND a NEW kade_professional that is NOT the individually
// invited keighty_pro (= Voice 541). The 17 parked exactly matches the Aug-6
// round-four count, the confidence check that the vet caught the right set.
// These 9 are the new NON-personal designed voices. Numbered-only picker per
// her rule; names live here + as hidden aliases. APPEND-ONLY as Voice 594+;
// same boot-crash rails as every prior block.
const VOICE_ADDITIONS_2026_08_19 = {
  "Voice 594": { target: "default-e-m11vgtr9l-m7afw4kmnw__quartney", name: "quartney" },
  "Voice 595": { target: "default-e-m11vgtr9l-m7afw4kmnw__koda", name: "Koda" },
  "Voice 596": { target: "default-e-m11vgtr9l-m7afw4kmnw__manayah", name: "Manayah" },
  "Voice 597": { target: "default-e-m11vgtr9l-m7afw4kmnw__evala", name: "Evala" },
  "Voice 598": { target: "default-e-m11vgtr9l-m7afw4kmnw__needa", name: "Needa" },
  "Voice 599": { target: "default-e-m11vgtr9l-m7afw4kmnw__dolya", name: "Dolya" },
  "Voice 600": { target: "default-e-m11vgtr9l-m7afw4kmnw__niah", name: "Niah" },
  "Voice 601": { target: "default-e-m11vgtr9l-m7afw4kmnw__fammy", name: "Fammy" },
  "Voice 602": { target: "default-e-m11vgtr9l-m7afw4kmnw__rayray", name: "Rayray" },
};
{
  const entries = Object.entries(VOICE_ADDITIONS_2026_08_19);
  if (entries.length !== 9) throw new Error(`additions 08-19: expected 9, got ${entries.length}`);
  entries.forEach(([label, info], idx) => {
    if (label !== `Voice ${594 + idx}`) throw new Error(`additions 08-19: non-contiguous at ${label}`);
    if (!info.target.startsWith("default-e-")) throw new Error(`additions 08-19: ${label} target shape`);
    if (NUMBERED_VOICE_ALIASES[label]) throw new Error(`additions 08-19: ${label} collides`);
    const display = `${label} ${info.name}`;
    NUMBERED_VOICE_ALIASES[label] = info.target;
    VOICE_MAP[label] = info.target;
    VOICE_MAP[display] = info.target;            // named form = hidden alias only
    VOICE_LIST.push(label);                      // numbered-only picker (her rule)
    CUSTOM_VOICE_NUMBERS.add(label);
    HIDDEN_VOICE_ALIASES.push(display);
  });
}

// ── VOICE CATEGORIES (July 23 2026, Kade: "I'd like to have voices loosely
// categorised based on the description of them... so the madness and chaos
// has some form and shape. Then when I add new voices they can kinda be snuck
// in where they fit.") ──
// Loose buckets derived from VOICE_CATALOG_2026-07-21.json's objective fields
// (gender/age/pitch/texture/accent/energy) + nickname/vibe keywords, one
// category per voice, reviewed set approved by Kade July 23. Categories are
// PRESENTATION ONLY: they group picker rows under section headers. They do
// NOT reorder VOICE_LIST (append-only ascending forever — hash-fallback
// voices index the raw array) and they change no resolution behavior.
// Numbers, not labels, so display-label changes never desync this table.
// NEW VOICES: add the number to whichever bucket fits; anything unfiled shows
// up in a trailing "More Voices" bucket (with a boot warning) so nothing can
// silently vanish from a sectioned picker.
// RETIRED FROM SERVING Aug 3 2026 (Kade: category gender mixups — "there's
// guys and girls mixed up... put them back in the numaric order or something
// so it doesn't confuse people"). Root cause: the buckets were derived from
// the catalog's BY-EAR gender labels, and Gemini's ear was wrong on some
// clones (receipt: Voice 431, her own fish title says "Female Rev", catalog
// said Male, filed with the men). The table below is kept DORMANT for a
// future re-audit; the picker serves one flat numeric section instead.
const VOICE_CATEGORIES = {
  "Everyday Women": [1, 6, 7, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 31, 36, 37, 38, 39, 42, 43, 45, 46, 47, 48, 49, 60, 61, 62, 63, 64, 65, 66, 67, 68, 71, 73, 74, 77, 78, 81, 82, 86, 88, 89, 97, 98, 105, 109, 111, 114, 117, 123, 124, 125, 126, 127, 128, 129, 132, 137, 138, 140, 141, 142, 143, 144, 148, 149, 150, 151, 153, 155, 157, 159, 163, 167, 169, 170, 171, 177, 180, 186, 190, 191, 192, 195, 197, 198, 199, 204, 205, 211, 213, 214, 216, 222, 223, 226, 229, 230, 232, 235, 236, 243, 247, 249, 252, 254, 255, 256, 257, 259, 262, 264, 265, 266, 267, 268, 269, 270, 271, 274, 277, 279, 282, 283, 293, 294, 295, 296, 297, 298, 300, 301, 302, 303, 306, 307, 308, 310, 314, 316, 319, 321, 324, 326, 359, 362, 365, 367, 370, 374, 380, 383, 391, 393, 402, 408, 410, 411, 414, 415, 417, 418, 419, 426, 427, 446, 449, 450, 451, 456, 464, 467, 469, 471, 473],
  "Everyday Men": [3, 35, 41, 53, 58, 75, 80, 84, 94, 95, 99, 107, 108, 110, 112, 119, 122, 130, 136, 145, 146, 160, 161, 162, 168, 172, 174, 178, 181, 189, 194, 200, 202, 210, 218, 219, 221, 224, 233, 238, 240, 242, 244, 248, 253, 260, 261, 263, 273, 284, 288, 289, 292, 299, 309, 312, 315, 333, 340, 350, 358, 360, 406],
  "Calm & Soothing": [28, 44, 104, 158, 179, 184, 196, 207, 239, 327, 357, 378, 412, 413, 416, 460, 466, 472, 474],
  "Deep & Smoky": [2, 4, 8, 27, 52, 69, 72, 79, 85, 87, 91, 102, 103, 133, 135, 185, 206, 212, 217, 220, 225, 228, 234, 237, 245, 246, 250, 251, 258, 275, 276, 278, 280, 281, 291, 318, 322, 343, 351, 361, 363, 364, 369, 398, 401, 404, 405, 407, 421, 422, 432, 452, 455, 463, 475],
  "Southern & Country": [34, 56, 57, 96, 285, 287, 317, 320, 323, 346, 348, 356, 375, 384, 425, 430, 433, 436, 440, 445, 459, 465],
  "Accents from Abroad": [32, 76, 83, 90, 92, 93, 101, 113, 116, 118, 120, 121, 131, 134, 139, 147, 152, 154, 156, 164, 165, 166, 173, 175, 176, 183, 187, 193, 201, 203, 209, 215, 231, 304, 313, 344, 353, 354, 385],
  "Storytellers & Pros": [70, 182, 188, 208, 241, 329, 330, 338, 342, 371, 429, 431, 438, 441, 470],
  "Wise & Seasoned": [33, 40, 55, 59, 106, 115, 227, 272, 286, 290, 311, 335, 336, 337, 339, 345, 347, 352, 372, 381, 382, 394, 395, 396, 397, 399, 400, 403, 409, 420, 434, 435, 437, 439, 442, 444, 448, 453, 454, 462],
  "Kids & Teens": [5, 16, 29, 30, 50, 51, 54, 325, 366, 368, 373, 376, 377, 379, 386, 387, 388, 389, 390, 392, 424, 428, 458, 461, 468],
  "Characters & Creatures": [9, 17, 100, 305, 328, 331, 332, 334, 341, 349, 355, 423, 443, 447, 457],
};
// Aug 3 2026: the picker serves ONE flat "All Voices" section in ascending
// numeric order (VOICE_LIST is append-only ascending; hash-fallback voices
// index the raw array — that contract is untouched). Shape is identical to
// the sectioned era ([{ name, voices }]) so the web and native pickers need
// zero changes. To revive categories: rebuild the section list from the
// dormant VOICE_CATEGORIES table above (and re-audit its genders first).
const VOICE_PICKER_CATEGORIES = [{ name: "All Voices", voices: [...VOICE_LIST] }];

// ── BOOT-TIME CATALOG INTEGRITY CHECK (July 17 2026, overnight proposal C) ──
// Scans the numbered map for (a) two numbers backed by the same real Inworld
// voice id and (b) gaps in the numbering. WARN-ONLY by design — a dupe or gap
// must never block boot (the hard assertions above already guard structural
// corruption). Known accepted dupes are allowlisted so the log stays quiet
// until something actually changes.
{
  const ACCEPTED_DUPES = new Set([
    "122|314", // jason — accepted July 16 audit
    "134|259", // luna
    "145|318", // nate
  ]);
  const byTarget = new Map();
  for (const [label, target] of Object.entries(NUMBERED_VOICE_ALIASES)) {
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(Number(label.replace("Voice ", "")));
  }
  for (const [target, nums] of byTarget) {
    if (nums.length < 2) continue;
    const key = nums.slice().sort((a, b) => a - b).join("|");
    if (ACCEPTED_DUPES.has(key)) continue;
    console.warn(
      `⚠️⚠️⚠️ [voice-catalog] DUPLICATE BACKING ID: Voices ${nums.sort((a, b) => a - b).join(" & ")} ` +
      `both resolve to "${target.split("__").pop()}" — two numbers, one voice. ` +
      `Either intentional (add to ACCEPTED_DUPES) or a copy-paste slip in an additions block.`,
    );
  }
  const have = new Set(
    Object.keys(NUMBERED_VOICE_ALIASES).map((l) => Number(l.replace("Voice ", ""))),
  );
  const max = Math.max(...have);
  const gaps = [];
  for (let i = 1; i <= max; i++) if (!have.has(i)) gaps.push(i);
  if (gaps.length) {
    console.warn(
      `⚠️⚠️⚠️ [voice-catalog] NUMBERING GAPS: missing Voice ${gaps.join(", Voice ")} ` +
      `(catalog runs 1-${max}). Pickers and spoken switching assume a contiguous list.`,
    );
  } else {
    console.log(`[voice-catalog] integrity check: ${have.size} numbered voices, contiguous 1-${max}, no unexpected dupes.`);
  }
}
const SAMPLE_TEXT = "Hi there \u2014 thanks for stopping to listen. Here's a little of what I can do. I can keep things calm and clear, like I'm reading you a story at the end of a long day. I can lift it right up when there's good news, because honestly, that's exciting! And when something really matters, I can slow down and get serious, so you know I mean every word. So... what do you think? If you're looking for a voice to ride along with you, maybe pick me. I'd love the part.";
// Short expressive audition monologue for every picker's browse-as-you-go
// samples (rewritten July 22 2026 on Kade's spec: "something everyone can say
// without saying their voice name... something that shows their range as
// people are scrolling... a short short monologue" — the old line opened
// with "I'm {voice}" which she explicitly retired). Four moods in ~15
// seconds: warm-easy, lit-up excited, dead serious, playful invite. Each %%%
// tag becomes an inline [bracket] direction in applySteeringTags — Inworld
// and fish s2.1 both honor the same dialect, so the whole catalog performs
// the same script. No {voice} placeholder anymore; the client-side
// `split('{voice}').join(...)` substitution is a harmless no-op. Kept to
// roughly half the old SAMPLE_TEXT so scroll-synth stays quick (the July 1
// lesson: the full monologue lagged when swiping).
const AUDITION_TEXT = "%%%calm, warm, unhurried, like the end of a long day%%% I can keep things soft and easy when that's what you need. %%%bright, delighted, grinning ear to ear%%% Or turn it all the way up — good news deserves loud! %%%low, slow, completely serious%%% And when it matters, I don't play around. %%%warm, playful, a little flirty%%% So... am I the one?";
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

app.get("/healthz", (_req, res) =>
  res.json({ ok: true, rev: (process.env.RAILWAY_GIT_COMMIT_SHA || "unknown").slice(0, 7) }));

// JSON version of the catalog + which entries are Kade's custom voices.
// Consumed by the fork's in-app voice pickers (agent-builder audition picker,
// settings voice dropdown) so the SAME source of truth that orders and badges
// the /voices library page orders the pickers too -- no hardcoded copy in the
// fork to go stale when the custom set changes. Labels only, nothing
// sensitive, so open CORS is fine (the fork's frontend is a different origin).
app.get("/voices.json", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=300");
  // `sample` is the same expressive monologue the /voices page performs --
  // the fork's picker auditions use it so both surfaces sound identical.
  // `aliases` (July 17 2026): the legacy NAMED labels the synth path still
  // resolves ('Zadiana', 'Kiana (Comedian)', …) — lets the fork's unified
  // voice resolver validate named picks and do agent-name matching against
  // the live truth instead of a hardcoded copy.
  // `hidden` (July 23 2026): old picker spellings (the beta-era labels) that
  // still resolve at synth but must never show in a picker — fork validators
  // union these with `voices` so stored old picks keep working forever.
  // `categories` (July 23 2026): ordered picker sections, presentation only.
  res.json({ voices: VOICE_LIST, custom: [...CUSTOM_VOICE_NUMBERS], aliases: Object.keys(CUSTOM_VOICE_MAP), hidden: HIDDEN_VOICE_ALIASES, categories: VOICE_PICKER_CATEGORIES, sample: SAMPLE_TEXT, audition: AUDITION_TEXT });
});

// RETIRED July 3 2026 (Kade's call): the standalone Voice Library page is
// obsolete now that the fork has in-app audition pickers (builder + settings).
// Old bookmarks land on the help page that explains voices instead of a 404.
// /voices.json above stays — the fork's pickers read it.
app.get(["/voices", "/voice-library"], (_req, res) => {
  res.redirect(302, "/help/voice");
});

// ── STT: OpenAI-compatible transcription shim → Deepgram (added July 18 2026) ──
// Lets LibreChat's speech.stt.openai.url point HERE instead of OpenAI Whisper,
// killing Whisper platform-wide: no per-minute OpenAI billing, no silence
// hallucinations (the "ghost" bug). LibreChat POSTs multipart/form-data with a
// `file` audio part + a `model` field (Bearer apiKey optional) and expects JSON
// { text }. We forward the audio bytes to Deepgram pre-recorded /v1/listen
// (nova-3) and return { text }. Rides the DEEPGRAM_API_KEY already on this svc.
const Busboy = require("busboy");
function sniffAudioType(b, fallback){
  if(!b || b.length < 12) return fallback;
  if(b[0]===0x1A && b[1]===0x45 && b[2]===0xDF && b[3]===0xA3) return "audio/webm"; // EBML
  if(b[4]===0x66 && b[5]===0x74 && b[6]===0x79 && b[7]===0x70) return "audio/mp4";   // ftyp
  if(b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46) return "audio/wav";   // RIFF
  if(b[0]===0x4F && b[1]===0x67 && b[2]===0x67 && b[3]===0x53) return "audio/ogg";   // OggS
  if(b[0]===0x49 && b[1]===0x44 && b[2]===0x33) return "audio/mpeg";                 // ID3
  if(b[0]===0xFF && (b[1]&0xE0)===0xE0) return "audio/mpeg";                          // mp3 frame
  return fallback;
}
app.post("/v1/audio/transcriptions", (req, res) => {
  const key = process.env.DEEPGRAM_API_KEY;
  if(!key) return res.status(500).json({ error: "DEEPGRAM_API_KEY not set on this service." });
  let bb;
  try { bb = Busboy({ headers: req.headers, limits: { fileSize: 160*1024*1024 } }); }
  catch(e){ return res.status(400).json({ error: "Bad multipart request." }); }
  const chunks = []; let partType = "", language = "", gotFile = false;
  bb.on("file", (name, stream, info) => {
    gotFile = true; partType = (info && info.mimeType) || "";
    stream.on("data", d => chunks.push(d));
    stream.on("limit", () => {});
  });
  bb.on("field", (name, val) => { if(name === "language" && val) language = val; });
  bb.on("error", () => { if(!res.headersSent) res.status(400).json({ error: "Upload parse error." }); });
  bb.on("close", async () => {
    if(!gotFile || !chunks.length) return res.status(200).json({ text: "" });
    const audio = Buffer.concat(chunks);
    const ct = sniffAudioType(audio, partType || "audio/webm");
    const p = new URLSearchParams({ model: "nova-3", smart_format: "true", punctuate: "true" });
    if(language && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(language)) p.set("language", language);
    try {
      const dg = await fetch("https://api.deepgram.com/v1/listen?" + p.toString(), {
        method: "POST",
        headers: { Authorization: "Token " + key, "Content-Type": ct },
        body: audio
      });
      const j = await dg.json();
      if(!dg.ok) return res.status(502).json({ error: (j && (j.err_msg || j.message)) || "Deepgram error" });
      const alt = (j && j.results && j.results.channels && j.results.channels[0] &&
                   j.results.channels[0].alternatives && j.results.channels[0].alternatives[0]) || {};
      return res.json({ text: (alt.transcript || "").trim() });
    } catch(e){ return res.status(502).json({ error: String(e) }); }
  });
  req.pipe(bb);
});


app.listen(PORT, () => {
  console.log(`Inworld TTS proxy running on port ${PORT}`);
});
