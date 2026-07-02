const express = require("express");
const app = express();
app.use(express.json());

// Mount the accessible help system (/help and friends). See help.js.
app.use(require("./help"));

// Forge's read-only Railway ops routes. See railway.js.
app.use(require("./railway"));

// Forge's GitHub commit/read routes. See github.js.
app.use(require("./github"));

// LibreChat platform-management routes for Forge (agents API, usage)
app.use(require("./librechat"));

const PORT = process.env.PORT || 3000;
const INWORLD_API_KEY = process.env.INWORLD_API_KEY;

// Voice performance tuning for inworld-tts-2. Note: this model IGNORES the
// `temperature` field entirely (per Inworld's own API docs -- "Ignored on
// inworld-tts-2. Use deliveryMode instead."), so deliveryMode is the real
// emotional-range knob here, not temperature. speakingRate is separate --
// pure pacing, [0.5, 1.5], 1.0 = the voice's own native speed.
// Both env-overridable so they can be re-tuned without a code change.
const TTS_DELIVERY_MODE = process.env.TTS_DELIVERY_MODE || "CREATIVE";
const TTS_SPEAKING_RATE = parseFloat(process.env.TTS_SPEAKING_RATE || "1.1");

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

async function synthesizeChunkOnce(text, voiceId, modelId, speakingRate) {
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
    throw err;
  }

  const data = await response.json();
  if (!data.audioContent) {
    throw new Error("No audioContent in Inworld response");
  }

  return Buffer.from(data.audioContent, "base64");
}

async function synthesizeChunk(text, voiceId, modelId, speakingRate) {
  return inworldLimiter(async () => {
    const maxAttempts = 4;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await synthesizeChunkOnce(text, voiceId, modelId, speakingRate);
      } catch (err) {
        lastErr = err;
        const retryable = err.isRateLimit || err.isTimeout;
        if (!retryable || attempt === maxAttempts) throw err;
        console.warn(`[TTS] chunk attempt ${attempt}/${maxAttempts} failed (${err.message}) -- retrying`);
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
  return text
    .replace(/:::thinking[\s\S]*?:::\n?/g, "")     // legacy :::thinking::: marker
    .replace(/<think>[\s\S]*?<\/think>\n?/g, "") // <think>...</think> from reframe-proxy
    .replace(/\uF001[\s\S]*?\uF002/g, "")        // PUA-wrapped reasoning text (extracted from think part by LibreChat before sending to TTS)
    .trim();
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
// ── Brand/name pronunciation normalization (AUDIO ONLY) ──────────────────────
// Kade's name is pronounced "Kadie" (KAY-dee) Murdock. Left as-is, Inworld sounds
// the brand handles out wrong ("kah-day-mur-dock"). Rewrite the SPOKEN form to a
// phonetic spelling. This only touches the text sent to Inworld for synthesis —
// the visible chat text the user reads on screen is never modified.
function fixPronunciations(text) {
  if (!text) return text;
  return text
    // Most specific first so stems don't get half-replaced.
    .replace(/kademurdock[-_ ]?ai/gi, "Kadie Murdock A.I.")
    .replace(/kademurdock/gi, "Kadie Murdock")   // also covers kademurdock.com, @kademurdock
    .replace(/kade[-_ ]?ai/gi, "Kadie A.I.")     // the Kade-AI platform brand
    .replace(/\bkade\b/gi, "Kadie");            // bare first name -> KAY-dee
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
const NONVERBAL_TAGS = new Set(["laugh", "breathe", "clear throat", "sigh", "cough", "yawn"]);

// Convert sentinel-wrapped tags to real [bracket] steering for TTS-2, AND
// carry a leading "direction" (anything that isn't a fixed non-verbal, e.g.
// "[say playfully]" or "[speak through gritted teeth]") forward onto every
// paragraph that doesn't already open with its own tag. This matters because
// chunkText() below fires each paragraph-group at Inworld as its OWN
// separate request/utterance for parallel synthesis -- without this, a long
// multi-paragraph reply would only sound expressive on the first chunk, since
// Inworld only honors a leading direction once, at an utterance's start.
// Inline non-verbals need no such treatment; they stay exactly where written.
function applySteeringTags(text) {
  if (!text || text.indexOf("%%") === -1) return text;
  // Tag-typo tolerance (July 2 2026, seen live from Kiana): models sometimes
  // emit "%%sigh%%" or "%%%sigh%%" instead of the canonical "%%%sigh%%%".
  // Normalize any 2-4-percent delimited, short, direction-looking span to the
  // canonical form BEFORE parsing, so a typo'd tag still steers the voice
  // instead of being read aloud as "percent percent sigh".
  text = text.replace(/%{2,4}([a-zA-Z][a-zA-Z ’',!-]{0,60}?)%{2,4}/g, "%%%$1%%%");
  if (text.indexOf(STEERING_OPEN) === -1) return text;

  const tagRe = new RegExp(`${STEERING_OPEN}([\\s\\S]*?)${STEERING_CLOSE}`, "g");
  // Pass 1: sentinel -> real brackets, everywhere in the text.
  const converted = text.replace(tagRe, (_, raw) => `[${raw.trim()}]`);

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
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 || !parts[i].trim()) continue; // separator or blank -- leave untouched
    const opens = parts[i].match(bracketAtStart);
    if (opens) {
      if (!NONVERBAL_TAGS.has(opens[1].trim().toLowerCase())) active = opens[1].trim();
      continue; // paragraph already opens with its own tag -- don't double up
    }
    if (active) parts[i] = `[${active}] ${parts[i]}`;
  }
  return parts.join("");
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
const TTS_NORM_TARGET_DB = parseFloat(process.env.TTS_NORM_TARGET_DB || "-20"); // speech RMS target, dBFS
const TTS_NORM_MAX_BOOST_DB = parseFloat(process.env.TTS_NORM_MAX_BOOST_DB || "14");
const TTS_NORM_MAX_CUT_DB = parseFloat(process.env.TTS_NORM_MAX_CUT_DB || "14");

const voiceLevelEma = new Map(); // resolved inworld voice id -> smoothed speech RMS (dBFS)

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

function normalizeLoudness(pcmBuf, sampleRate, voiceKey) {
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
    const level = prior == null ? rmsDb : prior + (rmsDb - prior) * alpha;
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
    if (peak > 0) gain = Math.min(gain, 32000 / peak);

    if (Math.abs(gain - 1) < 0.03) return pcmBuf; // ~0.25 dB, not worth touching
    for (let i = 0; i < total; i++) {
      let v = Math.round(pcmBuf.readInt16LE(i * 2) * gain);
      if (v > 32767) v = 32767;
      else if (v < -32768) v = -32768;
      pcmBuf.writeInt16LE(v, i * 2);
    }
    console.log(
      `[TTS] normalize: voice="${voiceKey}" measured ${rmsDb.toFixed(1)} dBFS (level ${level.toFixed(1)}), applied ${(20 * Math.log10(gain)).toFixed(1)} dB`
    );
  } catch (e) {
    console.warn("[TTS] normalize skipped:", e.message);
  }
  return pcmBuf;
}

app.post("/v1/audio/speech", async (req, res) => {
  if (!INWORLD_API_KEY) {
    return res.status(500).json({ error: "INWORLD_API_KEY not set" });
  }

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

  const inworldVoice = VOICE_MAP[voice] || voice;
  const inworldModel = MODEL_MAP[model] || "inworld-tts-2";

  // Strip web-search citation markers before speaking. The search-augmented
  // model embeds inline citation tokens (a private-use char U+E200-U+E20F
  // followed by a "turn0search3"-style id) into its answer; these render as
  // source chips in the UI but TTS otherwise reads them aloud as gibberish
  // mid-sentence. Visible message text is untouched (this only cleans audio).
  const speakText = applySteeringTags(fixPronunciations(stripCitationMarkers(stripThinkingBlock(input))));
  console.log(`[TTS] input len=${input.length}, after strip len=${speakText.length}, first 200: ${JSON.stringify(speakText.slice(0,200))}`);
  // If stripping removed all content (e.g. LibreChat sent thinking-only TTS call), return silence
  if (!speakText.trim()) {
    console.log('[TTS] nothing to speak after stripping — returning empty audio');
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': '0' });
    return res.status(200).end();
  }

  try {
    const chunks = chunkText(speakText);

    // Fire every chunk at Inworld in parallel instead of waiting on one
    // giant request -- this is the actual latency fix.
    const tSynth = Date.now();
    const wavBuffers = await Promise.all(
      chunks.map((chunk) => synthesizeChunk(chunk, inworldVoice, inworldModel, speakingRate))
    );
    console.log(`[TTS] synth ok: ${chunks.length} chunk(s) in ${Date.now() - tSynth}ms (telephony=${req.query.telephony === "1" ? "yes" : "no"})`);

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
);const SAMPLE_TEXT = "Hi there \u2014 thanks for stopping to listen. Here's a little of what I can do. I can keep things calm and clear, like I'm reading you a story at the end of a long day. I can lift it right up when there's good news, because honestly, that's exciting! And when something really matters, I can slow down and get serious, so you know I mean every word. So... what do you think? If you're looking for a voice to ride along with you, maybe pick me. I'd love the part.";
// Short expressive audition line for the in-app picker's browse-as-you-go
// samples (Kade 2026-07-01: the full SAMPLE_TEXT monologue lagged when
// swiping; this keeps the character but synthesizes in a fraction of the
// time). The %%% sentinel becomes real [bracket] emotion steering in
// applySteeringTags on the synth path -- same pipeline as chat. {voice} is
// replaced client-side with the numbered label so each voice introduces
// itself by name.
const AUDITION_TEXT = "%%%warm, playful, quietly showing off%%% Hey — {voice} here! And this right here? That's exactly how I sound.";
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
  res.json({ voices: VOICE_LIST, custom: [...CUSTOM_VOICE_NUMBERS], sample: SAMPLE_TEXT, audition: AUDITION_TEXT });
});

app.get(["/voices", "/voice-library"], (req, res) => {
  // (b) Float Kade's custom-made/specialty voices to the top, keeping the existing
  //     order for the rest. 2026-07-01: labels are now "Voice N" numbers, so the
  //     floating check runs against CUSTOM_VOICE_NUMBERS (which numbers used to be
  //     a CUSTOM_VOICE_MAP entry) instead of matching old friendly-name strings --
  //     matching against the old names would silently float nothing anymore since
  //     VOICE_LIST no longer contains any of those strings.
  //     The OpenAI-style aliases (alloy/echo/fable/onyx/nova/shimmer) were already
  //     dropped from VOICE_LIST itself, so there's nothing left to filter out here.
  // 2026-07-01: badges retired (Kade: customs should not be distinguishable).
  // The renumbering already puts her customs first as Voice 1-70, so the
  // float below is a no-op kept for safety; the page just stops saying/showing
  // which entries are custom.
  const custom = [];
  const displayList = [
    ...VOICE_LIST.filter((v) => CUSTOM_VOICE_NUMBERS.has(v)),
    ...VOICE_LIST.filter((v) => !CUSTOM_VOICE_NUMBERS.has(v)),
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
