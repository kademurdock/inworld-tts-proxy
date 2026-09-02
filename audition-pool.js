"use strict";
/**
 * audition-pool.js — WHAT A VOICE SAYS WHEN YOU AUDITION IT (Part 116.9, Sep 2 2026)
 *
 * Her words, after two swings at this in one night:
 *   "When I say I want varying audition lines, I mean just things anybody
 *    would say, with the acting tags and everything. These voices don't all
 *    belong to characters, there are hundreds of them and you assign them to
 *    whatever character you want… It can just be the voice introducing itself
 *    in a way that's expressive and shows the voice in conversation off. It
 *    can be any bucket of quotes. Doesn't even need to be anything but some
 *    stuff you make up."
 *
 * So this is a BUCKET, not a template. Part 115's six scripts all had the same
 * skeleton (soft / loud / serious / punchline) and read like six coats of the
 * same paint. These are different KINDS of talking — a voicemail, a weather
 * report, a bedtime line, a sports call, gossip, a recipe, a pep talk, a
 * late-night DJ, a grandma on the phone — so seven hundred voices get to be
 * heard doing seven hundred different things.
 *
 * Rules, carried from Part 110 and 115 and kept on purpose:
 *   • One %%%direction%%% tag opens each paragraph, plain adjectives, no commas
 *     inside the tag (the synth reads commas in a tag as a pause).
 *   • Paragraphs are 2–4 sentences. The proxy splits on the blank line; each
 *     paragraph rides as its own steered chunk, which is what makes the
 *     delivery actually change instead of one flat read.
 *   • Nothing here is anyone's persona. No Kade, no Kiana, no family names.
 *   • "{voice}" is replaced with the label ("Voice 12") where it appears; most
 *     scripts do not use it — a voice introducing itself by number is the one
 *     thing that DID get old.
 *   • No two picks in a row are the same script (pickAudition handles it).
 *
 * LONG = the web builder's audition and native's full audition.
 * QUICK = native's quick preview: two sentences, one tag, under ~140 chars.
 */

const LONG = [
  // ── introductions that are not "this is me soft, this is me loud" ────────
  [
    "%%%easy and warm like you have all evening%%% Hey. Pull up a chair. I can keep it soft when the day has been long.",
    "%%%lit up and quick barely holding it in%%% Or I can get LOUD when the news is good, because good news deserves it!",
    "%%%low and slow with every word weighed%%% And when it counts, I slow down and mean it.",
    "%%%dry with a smile you can hear%%% So. You gonna pick me, or keep scrolling?",
  ],
  [
    "%%%calm and steady like a porch at dusk%%% Evening. This is what I sound like when nothing is on fire.",
    "%%%bright and bouncing%%% This is me when you got the job, the apartment, or the last slice!",
    "%%%quiet and serious taking your time%%% And this is me when you need somebody to just tell you the truth.",
    "%%%playful and a little smug%%% Three voices, one me. Not bad, right?",
  ],
  // ── a voicemail ──────────────────────────────────────────────────────────
  [
    "%%%casual and a little rushed like leaving a message%%% Hey, it's me. You're not picking up, which, fair, it's Tuesday.",
    "%%%warmer slowing down%%% Anyway. I was thinking about what you said last night, and I think you were right. Don't let it go to your head.",
    "%%%brisk wrapping up%%% Call me back when you're done pretending you're busy. Bye. Okay bye.",
  ],
  // ── the weather ──────────────────────────────────────────────────────────
  [
    "%%%crisp and upbeat like the morning news%%% Good morning! Sixty-eight and sunny right now, with a high near eighty-four this afternoon.",
    "%%%conspiratorial dropping the newscaster voice%%% Between us, though, that storm line to the west is going to make a liar out of me by four o'clock.",
    "%%%bright and back on script%%% So grab a jacket, grab an umbrella, and grab somebody you like. Back to you.",
  ],
  // ── bedtime ──────────────────────────────────────────────────────────────
  [
    "%%%hushed and slow like the lights are already off%%% Okay. Phone down. Eyes closed. You did enough today, even the parts you're replaying right now.",
    "%%%soft with a little smile%%% The dishes will still be there tomorrow. They are very loyal that way.",
    "%%%barely above a whisper%%% Goodnight. I'll be here in the morning, and so will the coffee.",
  ],
  // ── the sports call ──────────────────────────────────────────────────────
  [
    "%%%steady and tense like a broadcaster in the final minute%%% Twelve seconds left, down by two. She brings it up the floor, nobody's open, she's got to go herself.",
    "%%%exploding with joy%%% AND SHE BANKS IT IN! ARE YOU KIDDING ME! Off the glass at the buzzer!",
    "%%%breathless and laughing%%% I have been doing this for twenty years and I am never, ever going to get tired of that.",
  ],
  // ── gossip on the porch ──────────────────────────────────────────────────
  [
    "%%%low and delighted like sharing a secret%%% Okay so you did not hear this from me. But Darlene's new fence? Six inches over the property line.",
    "%%%scandalized and thrilled%%% Six inches! And she KNOWS. She measured it herself and then acted surprised.",
    "%%%innocent and airy%%% Anyway. How's your mother.",
  ],
  // ── a recipe ─────────────────────────────────────────────────────────────
  [
    "%%%warm and matter of fact like a cooking show%%% Alright, cast iron on medium. Butter first, and don't you dare walk away from it.",
    "%%%pleased leaning in%%% When it starts smelling like a bakery, that's your cue. Onions in. Pinch of salt. Now we wait.",
    "%%%firm and fond%%% And no, you cannot rush it by turning up the heat. I know you. I see you reaching.",
  ],
  // ── the pep talk ─────────────────────────────────────────────────────────
  [
    "%%%steady and sure looking you in the eye%%% Listen to me. You have done harder things than this on worse sleep.",
    "%%%picking up energy%%% They picked you because you're the one who can do it. Not the one who looks calm. The one who can do it.",
    "%%%grinning and fired up%%% So go in there, take up all the room, and come tell me how it went. I want details.",
  ],
  // ── late-night radio ─────────────────────────────────────────────────────
  [
    "%%%smooth and low like a late night radio host%%% It's eleven fifty-two, and if you're still up, you're my people.",
    "%%%unhurried with a smile%%% This next one goes out to everybody driving home from a shift nobody thanked them for.",
    "%%%soft and sincere%%% You made it through today. That counts. Here's some music.",
  ],
  // ── grandma on the phone ─────────────────────────────────────────────────
  [
    "%%%warm and a little loud like talking on a landline%%% Baby, is that you? I can hear you fine, you don't have to holler.",
    "%%%fussing and fond%%% Are you eating? Don't tell me you're eating, tell me what you ate. Cereal is not a dinner.",
    "%%%softening%%% Well. I'm proud of you anyway. Come see me Sunday and bring nothing, I mean it.",
  ],
  // ── a museum tour ────────────────────────────────────────────────────────
  [
    "%%%polished and gently theatrical like a tour guide%%% If you'll follow me, on your left is a painting that took the artist eleven years to finish.",
    "%%%dry aside%%% Eleven years. His landlord was not a fan.",
    "%%%bright and moving on%%% Now, no touching, no flash, and yes, the gift shop is exactly where you think it is.",
  ],
  // ── the flight attendant ─────────────────────────────────────────────────
  [
    "%%%pleasant and practiced like an announcement%%% Folks, from the flight deck, we're about twenty minutes out and it looks like a smooth ride the rest of the way.",
    "%%%warmer and more human%%% Also, to whoever left a bag of homemade cookies in the galley: thank you, we ate them, we regret nothing.",
    "%%%cheerful signing off%%% Sit back, relax, and we'll have you on the ground before you finish that crossword.",
  ],
  // ── the apology ──────────────────────────────────────────────────────────
  [
    "%%%quiet and honest no performance in it%%% Hey. I was short with you this morning and you didn't deserve it.",
    "%%%steady owning it%%% That was about my day, not about you, and I put it on you anyway. I'm sorry.",
    "%%%lighter with a little hope%%% Can I make it up to you with the good tacos? The ones with the line?",
  ],
  // ── the courtroom ────────────────────────────────────────────────────────
  [
    "%%%crisp and commanding like a lawyer standing up%%% Objection, Your Honor. Counsel is asking the witness to guess.",
    "%%%measured and sharp%%% The question assumes facts not in evidence, and frankly, assumes facts not in this universe.",
    "%%%dry sitting back down%%% Withdrawn. But I'd like the record to show I enjoyed saying it.",
  ],
  // ── the fortune teller ───────────────────────────────────────────────────
  [
    "%%%mysterious and slow with a twinkle in it%%% Ahh. I see a long road. I see a decision you've been putting off.",
    "%%%dropping the act plain and friendly%%% Okay, I don't actually see anything, but you did sigh twice when you sat down, so.",
    "%%%warm and encouraging%%% Whatever it is, you already know the answer. You just want somebody to say it out loud. There. I said it.",
  ],
  // ── the big win ──────────────────────────────────────────────────────────
  [
    "%%%stunned and quiet like it just landed%%% Wait. Say that again. You got it?",
    "%%%erupting with happiness%%% YOU GOT IT! Oh my gosh, I KNEW it, I told you, I literally told you!",
    "%%%laughing and a little teary%%% Okay. Okay. I'm fine. I'm just really, really happy for you. Dinner's on me.",
  ],
  // ── a nature documentary ─────────────────────────────────────────────────
  [
    "%%%hushed and reverent like a nature documentary%%% Here, in the harsh light of the kitchen, the house cat stalks its prey.",
    "%%%building tension%%% The red dot. Elusive. Untouchable. It has evaded capture for six years and counting.",
    "%%%dry and resigned%%% The cat pounces. The dot is gone. The cat will not speak of this.",
  ],
  // ── the road trip ────────────────────────────────────────────────────────
  [
    "%%%loose and happy like windows down on a highway%%% Okay, next exit has gas, a pie place, and a sign that just says WORLD'S LARGEST with no other information.",
    "%%%decisive and gleeful%%% We're stopping. We are absolutely stopping. This is what the trip is FOR.",
    "%%%easy and content%%% Best decisions of my life have started with a sign like that.",
  ],
  // ── the hard day ─────────────────────────────────────────────────────────
  [
    "%%%gentle and low no rush at all%%% You don't have to explain it. I heard it in the first three words.",
    "%%%steady and present%%% We can fix it, or we can just sit here for a minute first. Your call. Both are allowed.",
    "%%%soft with a little strength in it%%% Whichever it is, I'm not going anywhere.",
  ],
  // ── the science fair ─────────────────────────────────────────────────────
  [
    "%%%bright and clear like explaining to a curious kid%%% So the sky is blue because sunlight is actually every color at once, all mixed together.",
    "%%%delighted%%% And the blue bits are the bouncy ones! They bounce off the air and scatter everywhere, so that's the color that reaches your eyes.",
    "%%%warm and proud%%% See? You already understood it. Now go make the poster look cool.",
  ],
  // ── the auctioneer ───────────────────────────────────────────────────────
  [
    "%%%fast and rhythmic like an auctioneer%%% I've got five, do I hear ten, ten to the lady in the hat, do I hear fifteen, fifteen!",
    "%%%slowing to a grin%%% Twenty? Twenty from the gentleman who has clearly never been to one of these before. Sir, that's a lamp.",
    "%%%snapping back to speed%%% Going once, going twice, SOLD, one lamp, one regret, congratulations!",
  ],
  // ── the workout ──────────────────────────────────────────────────────────
  [
    "%%%energetic and encouraging like a trainer%%% Alright, last set! I know your legs are filing a complaint. Overruled.",
    "%%%pushing harder%%% Three more. Two more. That last one is the only one that counts, give it to me!",
    "%%%easing off proud and warm%%% And done. Look at you. Go drink some water and be insufferable about it.",
  ],
  // ── the diner ────────────────────────────────────────────────────────────
  [
    "%%%friendly and unbothered like a diner waitress%%% Coffee, hon? Don't answer that, I'm pouring it.",
    "%%%conspiratorial%%% Skip the special. The meatloaf, though? The meatloaf will change your week.",
    "%%%brisk and kind%%% Take your time. Nobody's ever been rushed out of here and we're not starting with you.",
  ],
  // ── the last one ─────────────────────────────────────────────────────────
  [
    "%%%curious and open like meeting someone new%%% So what are you building? A friend, a coach, a smart-mouth, somebody to read to you at night?",
    "%%%warm and confident%%% Because I can do any of those. Give me a name and a job and I'll show up in the right clothes.",
    "%%%light and easy%%% Or keep browsing. There are seven hundred of us and no hard feelings. But I'd stay.",
  ],
].map((paras) => paras.join("\n\n"));

const QUICK = [
  "%%%warm and easy%%% Hey, it's me. Quick hello, and yes, I always sound this calm.",
  "%%%bright and quick%%% Hi! Oh good, you found me. Took you long enough.",
  "%%%low and unhurried%%% Hey there. Take your time, I'm not going anywhere.",
  "%%%dry with a smile%%% Yep, this is the voice. Keep scrolling or stop here, your call.",
  "%%%soft and kind%%% Hi. If you need it quiet, I can do quiet. Like this.",
  "%%%playful and a little smug%%% Oh, you found me. Good ear.",
  "%%%calm and steady%%% Hello. This is what I sound like most days. Nice to meet you.",
  "%%%delighted%%% Wait, me? You picked me? Okay, don't move, let me get it together.",
  "%%%conspiratorial%%% Come here. Closer. I do a really good secret voice.",
  "%%%brisk like leaving a voicemail%%% Hey, it's me, call me back. Actually don't, just pick me.",
  "%%%sleepy and content%%% Mm. Hi. You caught me on the porch. Best time of day.",
  "%%%fired up%%% Alright! Let's go! Whatever it is, we're doing it today!",
  "%%%gentle and slow%%% Rough one? Yeah. I can tell. Sit down a second.",
  "%%%crisp like a newscaster%%% Good evening. Here's what you need to know: I sound great.",
  "%%%teasing%%% You've listened to like forty of us. Your ears okay? Pick me and rest them.",
  "%%%earnest%%% I'll be honest with you even when it's not the fun answer. Especially then.",
  "%%%grinning%%% Say the word and I'll roast your brother-in-law's air fryer collection.",
  "%%%hushed like a nature documentary%%% Here we observe the human, choosing a voice. Majestic. Indecisive.",
  "%%%warm and a little loud like a landline%%% Baby, is that you? I hear you fine, no need to holler.",
  "%%%smooth like late night radio%%% It's late, you're up, and I've got the voice for it.",
  "%%%bright and clear%%% Okay, quick question. Do you want cheerful, or do you want honest? I can do both at once.",
  "%%%dry and unbothered%%% Coffee? Don't answer, I'm pouring. That's the kind of voice I am.",
  "%%%encouraging%%% Three more, two more, one more. See? You're already done. That's me on a good day.",
  "%%%curious and open%%% So what are we building? Give me a name and a job and I'll show up dressed for it.",
  "%%%quiet and honest%%% If I get something wrong, I'll say so. Out loud. First thing.",
  "%%%amused%%% I've been number twelve, number two hundred, and once, briefly, a talking skillet. I'm flexible.",
  "%%%tender%%% Goodnight voice, morning voice, three-in-the-afternoon-you-forgot-lunch voice. All in here.",
  "%%%mock serious%%% Objection. The listener is scrolling without hearing the full sample. Sustained.",
  "%%%happy and unhurried%%% Windows down, next exit, world's largest something. That's the energy I bring.",
  "%%%plain and steady%%% No tricks. This is just what I sound like when I'm telling you the truth.",
  "%%%bubbly%%% Hi hi hi! Okay I'll calm down. But not by much.",
  "%%%low and a little mischievous%%% You look like somebody who needs a co-conspirator. I'm available.",
];

/** Pick from a pool, never the same one twice in a row. */
const _last = new Map();
function pickAudition(pool, key = "default") {
  if (!Array.isArray(pool) || pool.length === 0) return "";
  if (pool.length === 1) return pool[0];
  let i = Math.floor(Math.random() * pool.length);
  const last = _last.get(key);
  if (i === last) i = (i + 1) % pool.length;
  _last.set(key, i);
  return pool[i];
}

module.exports = { LONG, QUICK, pickAudition };
