"use strict";
/**
 * audition-pool.js — WHAT A VOICE SAYS WHEN YOU AUDITION IT
 * (Part 117, Sep 2 2026 — rewritten from the Part 116.9 bucket)
 *
 * Her words, Sep 2 2026, on the 116.9 bucket:
 *   "With inworld voices, it wants to read some sentences slow, others fast,
 *    that makes it sound choppy. The emotions are perfect, they're great, and
 *    they go with the script. But they should be conversational phrases that
 *    don't sound like AI, and they shouldn't be character specific. They
 *    should be just, a paragraph of something anybody would say during any
 *    conversational scene in general. Just an audition for that voice,
 *    whatever it happens to be. But lots and lots of them. They just
 *    shouldn't be slop, you know? And they should be tagged properly."
 *
 * WHY THE OLD BUCKET LURCHED, MEASURED (same 150-char paragraph, Voice 595,
 * n=2 per arm, Sep 2 2026 through this proxy's own /v1/audio/speech):
 *
 *     no tag                            12.10  11.30
 *     [warm and amused]                 11.62  11.52
 *     [bright and delighted]            11.92  12.12
 *     [serious and sincere]             12.54  11.78
 *     [hushed and tender]               14.10  15.68   <- +25% to +40%
 *
 * That agrees with Part 109's table on server.js (emotion words move the
 * clock one to three percent; ONE tempo word swings it up to 69 points end to
 * end). The 116.9 scripts asked for the lurch on purpose: "low and slow",
 * "lit up and quick", "unhurried", "rushed", "brisk", "fast and rhythmic",
 * "hushed", "barely above a whisper", then "exploding" in the next paragraph.
 * Authored tags are sent to Inworld verbatim (the tempo strip in
 * stripTempoForCarry only touches CARRIED copies), so every one of those
 * landed exactly as written and the delivery stepped between paragraphs.
 *
 * Inworld's own steering doc (read Sep 2 2026): "Speed: faster for urgency
 * and tension, slower for weight and clarity" is its own axis, and "vocal
 * style" (whisper, hushed, sing) is another. Emotion is a third. This file
 * uses only the third one.
 *
 * RULES (audition-pool.test.js enforces every one of them):
 *   • One %%%direction%%% tag opens each paragraph. Lowercase, no commas, no
 *     punctuation inside the tag (Inworld's best-practice note).
 *   • A tag names a FEELING, never a pace and never a vocal style. No slow,
 *     quick, brisk, unhurried, rushed, hushed, whisper, breathless, shouting,
 *     loud, quiet, low tone, measured, deliberate. The test carries the list.
 *   • A tag names no job and no character. No newscaster, auctioneer, grandma,
 *     lawyer, trainer, DJ. It is "warm and a little amused", not "like a
 *     diner waitress".
 *   • The words are things anybody says: catching up, making plans, a small
 *     complaint, a memory, running late, the weather, being hungry, a
 *     compliment, a mild disagreement, a story from the day. No roles, no
 *     names, no "I'm a voice, pick me" (that got old, Part 116.9 said so).
 *   • No shouting in caps. Capitals are Inworld's emphasis control and a
 *     shouted word re-times the sentence around it.
 *   • A script is ONE to THREE paragraphs (117.7, her word: "they don't all
 *     have to be super long… some can be way shorter as long as it's more
 *     than 2 short sentences"), at least three sentences in all. Paragraphs
 *     are 2–3 sentences. The proxy splits on the blank line and
 *     performs each paragraph as its own steered chunk with the previous
 *     paragraphs as synthesis context, which is how the feeling gets to
 *     change without the pace changing.
 *   • No slop: no "I'm here for you", no "you've got this", no "it's okay to
 *     not be okay", no "let's dive in", no em dashes, no "honestly" openers.
 *
 * Part 117.2: batch two added at her word ("add even more of them").
 * Part 117.6: batch three. Her target is a THOUSAND OR MORE, hand-written
 * only (her pick over model drafting) — "at least a probability of 2 or more
 * per voice." Every session adds a batch; the test is the gate.
 *
 * LONG = the web builder's audition and native's full audition.
 * QUICK = native's quick preview: two sentences, one tag, under ~150 chars.
 *
 * Add scripts freely. Do not put a pace word in a tag; the test will tell you.
 */

const LONG = [
  // ── catching up ──────────────────────────────────────────────────────────
  [
    "%%%warm and easy like catching up with someone you like%%% Hey, there you are. I feel like I haven't seen you in a month, and it's been what, nine days?",
    "%%%amused%%% Nothing new here. The neighbor got a leaf blower and now every Saturday sounds like an airport, so that's my life.",
    "%%%fond and curious%%% Anyway, tell me about you. How did the thing go, the thing you were nervous about?",
  ],
  [
    "%%%pleased and a little surprised%%% Oh, you're back already. I thought you said the appointment would take all afternoon.",
    "%%%interested%%% So how was it? Did they finally figure out what that noise in the car is, or are we still calling it a personality?",
    "%%%easygoing%%% Either way, sit down. I made too much rice again and somebody has to help me with it.",
  ],
  // ── the hall closet ──────────────────────────────────────────────────────
  [
    "%%%matter of fact with a bit of pride%%% Okay, so I finally cleaned out the hall closet. Two hours, three trash bags, and one box I didn't even open because I know what's in it and I'm not ready.",
    "%%%amused and baffled%%% I found three umbrellas. Three. We have never once left this house with an umbrella.",
    "%%%content%%% But it's done, and now the vacuum has a home, and I feel like a different person. A person with a closet.",
  ],
  // ── running late ─────────────────────────────────────────────────────────
  [
    "%%%apologetic and a little flustered%%% I know, I know, I'm late. I had my keys in my hand and then I set them down to grab my jacket and they just vanished.",
    "%%%sheepish%%% They were in the jacket. They were in the pocket of the jacket I was putting on to go look for them.",
    "%%%warm and relieved%%% Anyway, I'm here now. Did you order yet, or were you waiting on me like a saint?",
  ],
  // ── the weather ──────────────────────────────────────────────────────────
  [
    "%%%cheerful%%% It is gorgeous out today. The kind of day where you open every window and then remember why you don't, because now there's a wasp in the kitchen.",
    "%%%wry%%% He's fine. He's just looking around. We have an understanding.",
    "%%%hopeful%%% You should come over later and we'll sit on the back step. I'll even move the wasp.",
  ],
  [
    "%%%mildly annoyed%%% Well, the rain finally showed up, about three hours after they said it would and right when I got the laundry out on the line.",
    "%%%resigned and amused%%% So the sheets got washed twice today. They're the cleanest sheets in the county.",
    "%%%warm%%% It's nice, though. It smells like dirt and pennies out there and the whole street got quiet.",
  ],
  // ── a small win ──────────────────────────────────────────────────────────
  [
    "%%%proud and trying to be casual about it%%% So, small thing. I fixed the drawer. The one that's been sticking since we moved in.",
    "%%%delighted%%% It was one screw. One screw and a little bit of soap on the runner, and now it glides like it's on a cloud.",
    "%%%playful%%% I've opened and closed it about forty times. Come over here and open my drawer. I need you to see this.",
  ],
  // ── the compliment ───────────────────────────────────────────────────────
  [
    "%%%sincere%%% Can I tell you something? The way you handled that yesterday, with your sister on the phone, that was really something.",
    "%%%warm and admiring%%% You didn't get pulled into it. You just said what was true and let it sit there, and I've never once managed to do that with anybody.",
    "%%%light%%% So that's it, that's the whole speech. You're good at a hard thing. Go get a snack.",
  ],
  // ── being hungry ─────────────────────────────────────────────────────────
  [
    "%%%earnest and a little dramatic%%% Okay, I need to eat something in the next ten minutes or I'm going to become a problem.",
    "%%%deciding%%% There's the leftover pasta, there's the eggs, or we could just go to the taco place and stop pretending we were going to cook.",
    "%%%pleased with the plan%%% Tacos. Great. I'm getting my shoes on and I'm not discussing it further.",
  ],
  // ── the memory ───────────────────────────────────────────────────────────
  [
    "%%%wistful and warm%%% You know what I was thinking about this morning? That summer we painted the fence, and it rained before it dried, and the whole thing came out speckled.",
    "%%%fond and amused%%% Everybody hated it. And then by August it just looked like that was the plan, and the lady across the road asked how we did it.",
    "%%%content%%% I still think about that fence. Some of the best things I've ever done were mistakes I didn't fix.",
  ],
  // ── the mild disagreement ────────────────────────────────────────────────
  [
    "%%%patient but firm%%% See, I get it, but I don't think that's what she meant. I think she was just tired and it came out wrong.",
    "%%%reasonable%%% You've done the same thing. I've done the same thing. Last Tuesday I told the mailman to have a good weekend and it was Tuesday.",
    "%%%gentle%%% Give her a day. If it still bugs you tomorrow, then we'll talk about it, but I bet it won't.",
  ],
  // ── the plan for saturday ────────────────────────────────────────────────
  [
    "%%%upbeat%%% Okay, here's my idea for Saturday. We get up whenever, we go to the farmer's market, and we buy way too many peaches.",
    "%%%playful%%% Then we come home and eat peaches over the sink like animals, and we don't feel bad about it.",
    "%%%warm%%% And then maybe a nap. That's the whole plan. I think it's my best work.",
  ],
  // ── good news on the phone ───────────────────────────────────────────────
  [
    "%%%surprised and happy%%% Wait, they called you back? Already? I thought they said two weeks.",
    "%%%delighted%%% That's great. That's really, really great. I'm doing a little dance in the kitchen right now and I need you to know that.",
    "%%%warm and sincere%%% You earned this. All those late nights, all that second-guessing. Let yourself be happy for a full day before you start worrying about the next part.",
  ],
  // ── the hard day ─────────────────────────────────────────────────────────
  [
    "%%%gentle and sympathetic%%% Yeah. That sounds like a lot for one day. You don't have to walk me through all of it if you don't want to.",
    "%%%steady and kind%%% I'm going to put the kettle on, and you can talk or not talk, either one is fine with me.",
    "%%%warm%%% And later, if you feel like it, we'll figure out what to do about the car. It doesn't have to be tonight.",
  ],
  // ── the grocery store ────────────────────────────────────────────────────
  [
    "%%%exasperated and amused%%% So I went in for milk. Milk. One thing. And I came out with a candle, a bag of clementines, and a pack of batteries I don't need.",
    "%%%sheepish%%% No milk. I got all the way to the car and I could see the milk in my head, sitting there in the cooler, judging me.",
    "%%%deciding%%% I'm going back. Come with me and hold my hand past the candle aisle.",
  ],
  // ── the dog ──────────────────────────────────────────────────────────────
  [
    "%%%fond and exasperated%%% The dog figured out how to open the pantry. Not the latch, the actual door. She hooks it with her paw and pulls.",
    "%%%amused%%% I came home and she was just sitting there in a pile of oatmeal packets, looking at me like I was the one who did something wrong.",
    "%%%affectionate%%% I can't even be mad. She's a genius. A genius who's now on a diet.",
  ],
  // ── the birthday ─────────────────────────────────────────────────────────
  [
    "%%%warm and a little teasing%%% So your birthday's coming up, and I'm not going to ask what you want, because you'll say nothing, and then I'll get you nothing, and we've been through this.",
    "%%%conspiratorial%%% I already got the thing. It's already wrapped. It's in a place you'll never find it, which is the trunk of my car.",
    "%%%pleased%%% You're going to love it. I'm more excited than you are, and I'm okay with that.",
  ],
  // ── the neighbor ─────────────────────────────────────────────────────────
  [
    "%%%curious%%% Did you see the new people moved into the blue house? They've got a truck, a trailer, and what I'm pretty sure is a canoe.",
    "%%%amused%%% There's no water for forty miles. I'm not judging. I'm just very interested.",
    "%%%warm and neighborly%%% I'm going to bring them a pie tomorrow and get the story. I'll report back.",
  ],
  // ── the lost thing ───────────────────────────────────────────────────────
  [
    "%%%worried and trying to stay calm%%% Okay, don't panic, but have you seen the folder? The blue one, the one with all the papers for Thursday?",
    "%%%working it out%%% I had it on the counter, then I moved it because of the groceries, then I think I put it on the chair, and the chair is empty.",
    "%%%relieved and a little embarrassed%%% Oh. It's in my bag. It's been in my bag this whole time. Okay. I'm going to sit down for a second.",
  ],
  // ── the morning ──────────────────────────────────────────────────────────
  [
    "%%%groggy but good natured%%% Morning. I've had half a cup of coffee and I'm operating at about sixty percent, so be patient with me.",
    "%%%warming up%%% I did sleep, though. Actual sleep, the kind where you wake up and don't know what day it is. It was wonderful.",
    "%%%cheerful%%% What's the plan? And if the plan involves the hardware store, I'm in, but I need the other half of this coffee first.",
  ],
  // ── the thank you ────────────────────────────────────────────────────────
  [
    "%%%grateful and a little shy about it%%% Hey, I meant to say this earlier. Thank you for coming to get me last week. You didn't have to, and it was late, and you did anyway.",
    "%%%sincere%%% I don't always say things like this because I get weird about it. But it mattered.",
    "%%%light and warm%%% So. Dinner's on me this time. Don't argue, I already looked up the menu.",
  ],
  // ── the movie ────────────────────────────────────────────────────────────
  [
    "%%%enthusiastic%%% Okay, I finally watched it. The one you kept telling me about. You were right, I take back everything I said.",
    "%%%animated%%% The part with the letter? I had to pause it. I had to get up and walk around the room.",
    "%%%teasing%%% I'm still not watching the sequel, though. Don't push your luck.",
  ],
  // ── a quiet evening ──────────────────────────────────────────────────────
  [
    "%%%content and relaxed%%% This is nice. Just this, the porch, the crickets, nobody needing anything from me for an hour.",
    "%%%thoughtful%%% I used to think I had to fill every evening with something. Turns out sitting here doing nothing is a thing you can do.",
    "%%%warm%%% Stay a little longer. There's one more chair and the ice tea's not going to drink itself.",
  ],
  // ── the recipe went wrong ────────────────────────────────────────────────
  [
    "%%%rueful%%% So the bread didn't rise. At all. It's sitting in there like a hockey puck with ambition.",
    "%%%amused%%% I followed the recipe. I followed it exactly. I'm starting to think the yeast was just tired.",
    "%%%upbeat%%% Anyway, I'm calling it a flatbread and putting cheese on it, and nobody has to know.",
  ],
  // ── the long drive ───────────────────────────────────────────────────────
  [
    "%%%easygoing%%% We've got about two more hours, so settle in. There's snacks in the bag behind you and I'm not stopping for anything but gas.",
    "%%%playful%%% Unless we pass one of those signs for the world's largest something. Then all bets are off.",
    "%%%warm%%% Put on whatever you want. I'll even sit through the podcast about ships. I'm in a generous mood.",
  ],
  // ── the apology ──────────────────────────────────────────────────────────
  [
    "%%%sincere and a little uncomfortable%%% Hey. I was short with you this morning and it wasn't about you. I'd been up since four and I took it out on the closest person.",
    "%%%owning it%%% That's not an excuse, it's just what happened. I'm sorry.",
    "%%%hopeful%%% Can I start the day over? I'll make the good pancakes, the ones with the crispy edges.",
  ],
  // ── the garden ───────────────────────────────────────────────────────────
  [
    "%%%proud%%% Come look at the tomatoes. I know I said that last week, but they've gone crazy since then. One of them is bigger than my fist.",
    "%%%delighted%%% And the basil, I can't keep up with it. We're going to be eating pesto until October whether we like it or not.",
    "%%%warm and generous%%% Take some home. Take a lot. I'm serious, I'll fill a bag.",
  ],
  // ── the phone call home ──────────────────────────────────────────────────
  [
    "%%%warm and fond%%% Hey, it's me. No, nothing's wrong, I just hadn't heard your voice in a while and I was thinking about you.",
    "%%%interested%%% How's your knee? Did you go to that appointment or did you cancel it again like you do?",
    "%%%affectionate and a little stern%%% Go to the appointment. I'll call Thursday and I'm going to ask.",
  ],
  // ── the new job ──────────────────────────────────────────────────────────
  [
    "%%%nervous but excited%%% So first day is Monday. I've picked out what I'm wearing three times and changed my mind three times.",
    "%%%honest%%% I'm a little scared. Not of the work, I know the work. It's the part where I don't know where the bathroom is and everybody else does.",
    "%%%reassured and warm%%% But you're right, by Wednesday it'll be normal. It's always normal by Wednesday.",
  ],
  // ── the road construction ────────────────────────────────────────────────
  [
    "%%%exasperated%%% They closed the bridge again. The same bridge. I have to go all the way around by the feed store now, which adds twenty minutes.",
    "%%%grudgingly amused%%% On the plus side, I've discovered there's a stand out that way that sells boiled peanuts, so I've gained a habit.",
    "%%%easygoing%%% So if I show up with peanut juice on my shirt, that's why. The bridge did it.",
  ],
  // ── the kid's game ───────────────────────────────────────────────────────
  [
    "%%%proud and animated%%% You should have seen her out there today. She didn't score, but she got the ball away from the big kid twice and looked so pleased with herself.",
    "%%%fond%%% Afterwards she told me she wants to be a goalie now. Yesterday she wanted to be a veterinarian. I'm just along for the ride.",
    "%%%warm%%% We got ice cream. Obviously. That was never in question.",
  ],
  // ── the flat tire ────────────────────────────────────────────────────────
  [
    "%%%calm and a little tired%%% So I got a flat on the way home. Right past the gas station, which felt personal.",
    "%%%proud%%% But I changed it myself. Me, on the side of the road, with the little jack and everything. Took me forty minutes and I only swore twice.",
    "%%%amused%%% A guy stopped to help right as I was tightening the last one. I told him he was welcome to watch.",
  ],
  // ── the surprise visit ───────────────────────────────────────────────────
  [
    "%%%delighted and surprised%%% No way. What are you doing here? You said you weren't coming until next month.",
    "%%%overjoyed%%% Get in here. Get in here right now. I don't care that the house is a mess, I don't care that I'm in my old sweatpants.",
    "%%%warm and a little teary%%% You have no idea how much I needed this today. Sit. I'm going to feed you.",
  ],
  // ── the haircut ──────────────────────────────────────────────────────────
  [
    "%%%uncertain%%% Okay, be honest. Is it too short? It feels too short. I keep reaching up for hair that isn't there.",
    "%%%reassured%%% Really? Okay. Okay, good. She kept saying it would grow on me and I thought that was a threat.",
    "%%%pleased%%% It is kind of nice not having it in my face all the time. Maybe I'm a short hair person now. Who knew.",
  ],
  // ── the noise in the night ───────────────────────────────────────────────
  [
    "%%%unsettled but trying to laugh about it%%% So something was in the attic last night. Something with feet. Little feet, but a lot of them.",
    "%%%amused%%% I lay there for an hour deciding whether it was a raccoon or a ghost, and I want you to know I never fully ruled out the ghost.",
    "%%%decisive%%% I'm calling somebody today. For the raccoon. If it's a ghost we'll cross that bridge.",
  ],
  // ── the old friend ───────────────────────────────────────────────────────
  [
    "%%%warm and a little amazed%%% You'll never guess who I ran into at the pharmacy. Remember the guy from that summer job, the one who could whistle with his fingers?",
    "%%%fond%%% He's got three kids now and a beard and he still does the whistle. Did it right there by the vitamins. A lady dropped her basket.",
    "%%%content%%% We're going to get coffee next week. It's funny how somebody can be gone twenty years and then just be back.",
  ],
  // ── the bad joke ─────────────────────────────────────────────────────────
  [
    "%%%mischievous%%% Okay, I've got one. Why did the scarecrow win an award? Don't guess, you'll ruin it.",
    "%%%grinning%%% Because he was outstanding in his field. I know. I know. I heard it from a nine-year-old and I've been waiting all day to tell somebody.",
    "%%%pleased with yourself%%% You laughed. I saw it. You can pretend all you want, but that was a laugh.",
  ],
  // ── the missed call ──────────────────────────────────────────────────────
  [
    "%%%warm and casual%%% Hey, sorry I missed you, I was out back and left the phone on the counter like always.",
    "%%%interested%%% What's up? Your message just said call me, which either means good news or you need help moving a couch.",
    "%%%easygoing%%% Either way I'm around all afternoon. Just tell me if I need to bring the truck.",
  ],
  // ── the sunset ───────────────────────────────────────────────────────────
  [
    "%%%moved%%% Look at that. Come look at the sky. The whole west side is orange and pink and there's this one purple stripe in the middle.",
    "%%%thoughtful%%% I don't know why I never remember to look. It's up there every single evening doing this and I'm inside looking at the dishes.",
    "%%%warm%%% Leave the dishes. Two more minutes. It's already fading.",
  ],
  // ── the argument that wasn't ─────────────────────────────────────────────
  [
    "%%%mildly defensive%%% I didn't say you were wrong. I said I'd have done it differently, which is a completely different thing.",
    "%%%softening%%% Okay. Okay, I hear how that sounded. I'm not trying to be difficult, I just had a picture in my head of how it'd go.",
    "%%%warm and conciliatory%%% Your way worked, though. It worked fine. Forget I said anything and hand me that other paintbrush.",
  ],
  // ── the sick day ─────────────────────────────────────────────────────────
  [
    "%%%tired but cheerful%%% Yeah, I'm still under the weather. My head feels like it's full of wet towels and I've watched four episodes of a show I don't even like.",
    "%%%grateful%%% The soup helped, though. You didn't have to drive it all the way over, but it helped.",
    "%%%warm%%% I'll be fine by the weekend. I always am. Tell everybody I'm not dead, just dramatic.",
  ],
  // ── the wedding ──────────────────────────────────────────────────────────
  [
    "%%%happy and a little overwhelmed%%% The wedding was beautiful. It rained for exactly ten minutes and then stopped like somebody flipped a switch, and the whole yard smelled like wet grass.",
    "%%%moved%%% Her dad cried during the toast. Big guy, never seen him cry, and he just went. Everybody went after that.",
    "%%%fond and amused%%% And then the dancing. I danced with a seven-year-old for forty minutes and she was leading.",
  ],
  // ── the fishing trip ─────────────────────────────────────────────────────
  [
    "%%%relaxed and content%%% We didn't catch a thing. Six hours on the water, three of us, one bite, and it got away.",
    "%%%warm%%% Best day I've had in months. We just sat there and talked and didn't talk and ate sandwiches out of a cooler.",
    "%%%amused%%% I got sunburned on exactly one side of my neck, so I look like I've been marked for something.",
  ],
  // ── the house guest ──────────────────────────────────────────────────────
  [
    "%%%welcoming%%% Come on in, the door's open. Shoes wherever, don't worry about it, the floor's seen worse.",
    "%%%hospitable%%% There's coffee, there's tea, there's some kind of juice the kids left. The couch pulls out and I already put sheets on it.",
    "%%%warm%%% Stay as long as you need. I mean that. It's nice having somebody else's noise in the house.",
  ],
  // ── the recipe ───────────────────────────────────────────────────────────
  [
    "%%%matter of fact and friendly%%% So for the beans, you want the onion in first, and you let it go until it's soft, not brown, just soft.",
    "%%%warm%%% Then the garlic, then the beans, then more salt than you think. That's the secret. Everybody undersalts beans.",
    "%%%pleased%%% Let it sit for twenty minutes and it'll taste like somebody's grandmother made it. That's the whole trick.",
  ],
  // ── the flight ───────────────────────────────────────────────────────────
  [
    "%%%relieved%%% I'm on the ground. Finally. There was a delay in the first city and a longer delay in the second one and I've been in the same socks since yesterday.",
    "%%%amused%%% The guy next to me slept the whole way with his mouth open and woke up right as we landed and asked if we'd left yet.",
    "%%%warm and eager%%% I'll be at the curb in ten minutes. Please have something to eat in the car. Anything. A cracker.",
  ],
  // ── the estimate ─────────────────────────────────────────────────────────
  [
    "%%%skeptical%%% So the guy came out to look at the roof, and he walked around for five minutes, and then he gave me a number that made me laugh out loud.",
    "%%%dry%%% I wasn't trying to be rude. It just came out. He didn't think it was funny.",
    "%%%practical%%% I'm getting two more quotes. Your cousin does roofs, right? Give me his number.",
  ],
  // ── the big decision ─────────────────────────────────────────────────────
  [
    "%%%thoughtful and a little uncertain%%% I keep going back and forth on it. One minute it's obviously the right thing and the next minute I think I've lost my mind.",
    "%%%honest%%% Part of me just wants somebody to tell me what to do. I know that's not how it works, but I want it anyway.",
    "%%%calmer and warmer%%% Thanks for listening to me go in circles. I think I already know what I'm going to do. I just needed to hear myself say it.",
  ],
  // ── the concert ──────────────────────────────────────────────────────────
  [
    "%%%energized%%% That show was unbelievable. My ears are still ringing and I don't even care. They played the old stuff, all of it.",
    "%%%delighted%%% And the guy behind us knew every word. Every word. He was terrible and I loved him.",
    "%%%happy and tired%%% I'm going to be useless tomorrow and it was worth it. Let's go get pancakes.",
  ],
  // ── the puzzle ───────────────────────────────────────────────────────────
  [
    "%%%focused and a little frustrated%%% I've been on this crossword for an hour. Six letters, starts with a P, and the clue is just the word again with a question mark.",
    "%%%triumphant%%% Oh. Oh, it's a pun. It's a pun, it's not even a real word. Got it.",
    "%%%satisfied%%% That's the whole thing done. I'm going to sit here and feel smart for a minute before I start dinner.",
  ],
  // ── the storm ────────────────────────────────────────────────────────────
  [
    "%%%alert but calm%%% Okay, the power's out on our street. I've got the candles lit and the flashlight's by the door and the fridge is staying shut.",
    "%%%easygoing%%% It's kind of nice, actually. No hum from anything. You can hear the rain on the roof.",
    "%%%warm%%% If it's still out in the morning we'll go to the diner. Until then, I've got a deck of cards and nothing but time.",
  ],
  // ── the first snow ───────────────────────────────────────────────────────
  [
    "%%%delighted%%% It's snowing. Come look, it's actually snowing, big fat flakes, the kind that stick to your eyelashes.",
    "%%%fond%%% I know we'll be sick of it by February. I don't care. Right now it looks like a snow globe out there.",
    "%%%playful%%% I'm making cocoa. If you want some you have to come out and stand in it with me for one minute first.",
  ],
  // ── the return ───────────────────────────────────────────────────────────
  [
    "%%%mock exasperated%%% So I tried to return the blender. I had the receipt, I had the box, I had everything.",
    "%%%amused%%% And the kid at the counter looked at it and said it'd been opened. Yes. Yes, it has been opened. That's how I found out it doesn't work.",
    "%%%philosophical%%% I got store credit. I'm going to buy a different blender with it. The circle of life.",
  ],
  // ── the lullaby that isn't ───────────────────────────────────────────────
  [
    "%%%tender%%% All right, that's enough for tonight. You've read the same page three times and I watched you do it.",
    "%%%gentle and amused%%% The book will still be there tomorrow. The book is very patient. More patient than you.",
    "%%%warm%%% I'll turn the hall light off. Yell if you need anything. I'm right down the hall.",
  ],
  // ── the interview ────────────────────────────────────────────────────────
  [
    "%%%nervous and hopeful%%% I think it went okay? They asked about the gap on my resume and I told them the truth, and the guy actually nodded.",
    "%%%encouraged%%% Then at the end she said she'd be in touch by Friday, and she said it like she meant it, not like the way people say it.",
    "%%%grounded%%% So we'll see. I'm not going to check my email every four minutes. I'm going to check it every twenty.",
  ],
  // ── the mess ─────────────────────────────────────────────────────────────
  [
    "%%%good natured%%% Yes, the kitchen looks like this on purpose. I'm making the thing with the layers, and the thing with the layers takes every bowl I own.",
    "%%%pleased%%% It's going to be worth it. Trust the process. Ignore the flour on the ceiling, I don't know how it got there either.",
    "%%%warm%%% Give me an hour. Then sit down and act impressed, because I'm going to need it.",
  ],
  // ── the neighbor's kid ───────────────────────────────────────────────────
  [
    "%%%amused and fond%%% The kid next door came over to ask if I had a job for him. He's eight. He brought his own rake.",
    "%%%warm%%% So I let him do the front yard, and he did about a third of it and then found a toad and that was the end of the raking.",
    "%%%pleased%%% I paid him anyway. Five dollars. He said he'd be back tomorrow for the rest, and you know what, I believe him.",
  ],
  // ── the road home ────────────────────────────────────────────────────────
  [
    "%%%peaceful%%% I took the long way home tonight. Down past the lake, where the road goes right along the water for a mile.",
    "%%%thoughtful%%% There was a heron standing in the shallows, just standing there, and I pulled over and watched him for a while. He didn't move once.",
    "%%%content%%% I don't know what I needed that for. But I needed it.",
  ],
  // ── the shopping list ────────────────────────────────────────────────────
  [
    "%%%organized and cheerful%%% Okay, list. Eggs, the good butter, whatever fruit looks decent, and that coffee you like, the one in the red bag.",
    "%%%thinking%%% Oh, and dog food. And a birthday card for your aunt. And I think we're out of the tall trash bags again.",
    "%%%warm%%% Text me if you think of anything else. I'll be the one in the produce section squeezing every peach.",
  ],
  // ── the cold morning ─────────────────────────────────────────────────────
  [
    "%%%bracing and cheerful%%% Well, it's cold enough to see your breath out there. The car took three tries to start and the windshield is a sheet of ice.",
    "%%%amused%%% The dog went out, stood on the step, looked at me like I'd done this to her personally, and came right back in.",
    "%%%warm%%% So we're having a slow start. Second pot of coffee's on. Come sit by the vent with me.",
  ],
  // ── the lost recipe ──────────────────────────────────────────────────────
  [
    "%%%searching%%% I can't find her cookie recipe. The one on the index card, with the coffee stain, in her handwriting.",
    "%%%worried%%% I've been through the whole box twice. I know it's in this house. I just don't know where I put it after last Christmas.",
    "%%%relieved and a little emotional%%% Oh. It's in the cookbook, I tucked it in the cookbook. There's her handwriting. Okay, we're good.",
  ],
  // ── the compliment returned ──────────────────────────────────────────────
  [
    "%%%warm and teasing%%% You clean up pretty good, you know that? I almost didn't recognize you without the paint on your hands.",
    "%%%sincere%%% No, really. You look happy. That's what looks good on you.",
    "%%%light%%% Now let's go before they give our table away. I did not put on real shoes for nothing.",
  ],
  // ── the last one ─────────────────────────────────────────────────────────
  [
    "%%%easygoing and open%%% So that's about it. That's the whole update. Nothing big, nothing bad, just a lot of small stuff adding up to a pretty good week.",
    "%%%warm%%% I like these calls. Even when there's nothing to say, there's always something to say.",
    "%%%fond%%% Talk soon. Say hi to everybody. And eat something, you sound hungry.",
  ],
  // ── batch two (Part 117.2, her ask: "add even more of them") ─────────────
  // ── the yard sale ────────────────────────────────────────────────────────
  [
    "%%%pleased and a little smug%%% Guess what I got at the yard sale down the street. A whole set of those heavy glass bowls, the green ones, for four dollars.",
    "%%%amused%%% The lady tried to throw in a lamp for free and I had to physically walk away. I do not need a lamp. I have never needed a lamp less.",
    "%%%warm%%% Come over and I'll make something in the bowls. That's the rule now. Everything gets served in the bowls.",
  ],
  // ── the dentist ──────────────────────────────────────────────────────────
  [
    "%%%relieved%%% Okay, I survived the dentist. No cavities, which I did not expect, because I've been treating flossing like a suggestion.",
    "%%%amused and a little embarrassed%%% She asked how often I floss and I said every day, and she just looked at me. She didn't say anything. She just looked.",
    "%%%upbeat%%% Anyway, my teeth feel like they've been to a spa. Let's get lunch. Something soft. I'm still a little numb.",
  ],
  // ── the borrowed thing ───────────────────────────────────────────────────
  [
    "%%%sheepish and friendly%%% So, remember when I borrowed your ladder? In April? I have some news about the ladder.",
    "%%%reassuring%%% It's fine. It's totally fine, it's in my garage, I've just been using it so much I started thinking of it as mine.",
    "%%%warm and a little teasing%%% I'll bring it back tonight. And a pie, as interest. That's a fair rate, right?",
  ],
  // ── learning something new ───────────────────────────────────────────────
  [
    "%%%enthusiastic%%% I started learning the guitar. Well, I started learning three chords on the guitar, which I'm told is enough for about half of all music.",
    "%%%rueful and amused%%% My fingertips feel like I've been pinching a hot pan, and the dog leaves the room every time I pick it up.",
    "%%%determined and cheerful%%% But I played a whole song last night. Badly. All the way through. I'm counting it.",
  ],
  // ── the car wash ─────────────────────────────────────────────────────────
  [
    "%%%content%%% I finally washed the car. Inside and out. There were four pens under the seat, a sock, and enough crumbs to feed a small bird for a week.",
    "%%%amused%%% I also found the sunglasses I bought a replacement pair for. So now I have two pairs, and I'll lose both by August.",
    "%%%pleased%%% But it smells like a new car right now. Get in before it wears off.",
  ],
  // ── the old photos ───────────────────────────────────────────────────────
  [
    "%%%warm and nostalgic%%% I found a whole box of old pictures in the closet today. Us at the lake, that Christmas with the huge tree, everybody's hair from back then.",
    "%%%fond and amused%%% There's one of you on the porch with a popsicle and no shirt and a look on your face like you owned the place. You were six.",
    "%%%tender%%% I'm putting a few of them in frames. It's time they lived out here where people can see them.",
  ],
  // ── the spider ───────────────────────────────────────────────────────────
  [
    "%%%mock brave%%% There's a spider in the bathroom. Not a small one. A spider with opinions.",
    "%%%amused and a little sheepish%%% I've been using the other bathroom for two days now and I'm not proud of it. We are sharing a house, me and the spider.",
    "%%%pleading and playful%%% Could you come deal with it? I'll make you dinner. I'll make you two dinners.",
  ],
  // ── the potluck ──────────────────────────────────────────────────────────
  [
    "%%%cheerful%%% So the potluck's Saturday, and I'm bringing the potato salad, the real one, not the store kind, don't panic.",
    "%%%conspiratorial%%% And I'm making a second batch to keep here, because last year it was gone in ten minutes and I didn't get any of my own food.",
    "%%%warm%%% Bring whatever you want. Bring napkins. Somebody always forgets napkins and it's usually me.",
  ],
  // ── the missing sock ─────────────────────────────────────────────────────
  [
    "%%%baffled and amused%%% I have eleven socks. Eleven. I did a whole load, I counted them going in, and one of them is just gone.",
    "%%%mock serious%%% I checked the dryer. I checked behind the dryer. I checked the dog. The dog was offended.",
    "%%%resigned and cheerful%%% So now I have a drawer of five pairs and one loner, and I'm keeping him. He's earned a spot.",
  ],
  // ── the late night ───────────────────────────────────────────────────────
  [
    "%%%tired and warm%%% Yeah, I'm still up. I got into one of those shows where every episode ends with a cliffhanger and now it's one in the morning.",
    "%%%amused%%% I told myself one more, three episodes ago. I'm a liar. A happy liar with a blanket.",
    "%%%gentle%%% Okay, this is the actual last one. Go to bed. I'll tell you what happens tomorrow.",
  ],
  // ── the new couch ────────────────────────────────────────────────────────
  [
    "%%%excited%%% The couch came. The couch is here. It is the biggest, deepest, most ridiculous couch I have ever sat on and I'm never getting up.",
    "%%%amused%%% The delivery guys had to take the door off the hinges. One of them said it was the third time this week for that model.",
    "%%%content%%% Come sit on it. Bring a book you're not going to read, because you'll fall asleep in about four minutes.",
  ],
  // ── the mixup ────────────────────────────────────────────────────────────
  [
    "%%%amused and apologetic%%% So I texted you about the thing for Thursday, but I sent it to my cousin instead, who now thinks she's invited to a dinner that isn't real.",
    "%%%laughing at yourself%%% She said yes. She's bringing a dessert. I don't have the heart to tell her, so I guess we're having a dinner on Thursday.",
    "%%%warm%%% Come. It's real now. You'll like her, she talks as much as you do.",
  ],
  // ── the sunrise ──────────────────────────────────────────────────────────
  [
    "%%%awed%%% I was up early enough to see the sun come up this morning, which never happens. The whole field was pink and the fog was sitting on it like a blanket.",
    "%%%thoughtful%%% I stood there with my coffee getting cold and didn't even mind. It felt like the day hadn't started yet and I was in on a secret.",
    "%%%warm%%% I'm not going to make a habit of it. But once in a while, that's worth the alarm.",
  ],
  // ── the hospital visit ───────────────────────────────────────────────────
  [
    "%%%gentle and steady%%% I went by and saw him today. He's tired, but he's himself. He asked about the game and complained about the pudding, so that's a good sign.",
    "%%%warm%%% The nurses like him. One of them told me he's been giving her grief about the thermostat, which is exactly what he does at home.",
    "%%%hopeful%%% They think he's home by the weekend. I'll pick him up. Somebody has to hear the thermostat speech on the way.",
  ],
  // ── the garage sale find ─────────────────────────────────────────────────
  [
    "%%%curious and delighted%%% Okay, so this old radio I picked up? I plugged it in expecting nothing, and it works. It picks up the station out of the next county.",
    "%%%fond%%% It's got that hum in the background, the old kind, like the sound has to warm up before it comes out.",
    "%%%content%%% It's living on the kitchen windowsill now. The kitchen has a soundtrack.",
  ],
  // ── the babysitting ──────────────────────────────────────────────────────
  [
    "%%%affectionate and worn out%%% I watched the twins all afternoon. I have been a horse, a bridge, a customer at a pretend restaurant, and briefly, a villain.",
    "%%%amused%%% The villain thing was not my choice. I was assigned. Apparently I have the face for it.",
    "%%%warm%%% They're asleep now. Both of them, at the same time, which I'm told is a miracle. I'm going to sit here very quietly and eat their crackers.",
  ],
  // ── the breakup talk ─────────────────────────────────────────────────────
  [
    "%%%gentle and sincere%%% I'm sorry. I know you saw it coming, and I know that doesn't make it hurt any less.",
    "%%%steady%%% You don't have to be okay about it yet. You don't have to be anything about it yet.",
    "%%%warm%%% I'm coming over with the bad movie and the good ice cream. Don't clean up. I've seen your apartment.",
  ],
  // ── the paint color ──────────────────────────────────────────────────────
  [
    "%%%thoughtful and indecisive%%% Okay, I've got four little squares of blue painted on the wall and I've been staring at them for a week.",
    "%%%amused and exasperated with yourself%%% They're all the same blue. I know they're not, they have different names, but they are the same blue.",
    "%%%decisive%%% I'm picking the second one. The one called something like morning tide. It's the same as the others but the name's nice.",
  ],
  // ── the marathon ─────────────────────────────────────────────────────────
  [
    "%%%proud and worn out%%% I finished it. Every mile. The last two, I was mostly walking and negotiating with my knees, but I crossed the line.",
    "%%%moved%%% And you know who was there? Everybody. The whole crew, with a sign that had my name spelled wrong, which somehow made it better.",
    "%%%happy%%% I'm never doing it again. Ask me next spring. I'll say the same thing and sign up anyway.",
  ],
  // ── the new neighbor's dog ───────────────────────────────────────────────
  [
    "%%%delighted%%% The new neighbors have a dog and he's already decided he lives here. He came right through the gate and lay down on my porch like it was his.",
    "%%%fond and amused%%% His name is Biscuit. Of course it is. He looks like a Biscuit.",
    "%%%warm%%% I gave him some water and now we're friends for life. His people can have him back at dinnertime.",
  ],
  // ── the cake ─────────────────────────────────────────────────────────────
  [
    "%%%proud%%% I made a layer cake. From scratch. Three layers, real frosting, and it's only leaning a little.",
    "%%%amused%%% The middle layer slid about an inch while I was frosting it, so I told everybody that's the design. It's a modern cake.",
    "%%%pleased%%% It tastes great, though. That's what counts. Come get a slice before I eat the leaning part myself.",
  ],
  // ── the long weekend ─────────────────────────────────────────────────────
  [
    "%%%relaxed%%% Three days off. I have no plans, and I'm protecting that with my life.",
    "%%%content%%% I might read on the porch. I might fix the screen door. I might do both, or neither, and nobody can say a word about it.",
    "%%%warm and playful%%% You can come by, but you have to bring the no-plans energy with you. No errands. No lists. Just sit.",
  ],
  // ── the lost dog found ───────────────────────────────────────────────────
  [
    "%%%relieved and emotional%%% We found her. She was two streets over, sitting on somebody's porch like she'd been invited, and they'd been feeding her ham.",
    "%%%laughing with relief%%% Ham! She's been gone a day and a half and she's been eating better than I have.",
    "%%%warm%%% She's home. She's asleep on my feet right now. I'm not moving for the rest of the night.",
  ],
  // ── the bad haircut, someone else's ──────────────────────────────────────
  [
    "%%%careful and kind%%% Okay. So. It's shorter than you asked for. I'm not going to pretend it isn't.",
    "%%%warm and encouraging%%% But it actually suits you. You can see your face now. I didn't know you had cheekbones.",
    "%%%light%%% And in three weeks it'll be exactly what you wanted. Hair is the one thing that always fixes itself.",
  ],
  // ── the storm cleanup ────────────────────────────────────────────────────
  [
    "%%%matter of fact%%% Well, the big branch came down. Missed the house, missed the car, took out the birdbath. The birdbath never had a chance.",
    "%%%grateful%%% The guy across the road was over with his chainsaw before I'd even found my boots. Didn't ask. Just started cutting.",
    "%%%warm%%% We've got firewood for two winters now. Come help me stack it and I'll feed you.",
  ],
  // ── the interview, the other side ────────────────────────────────────────
  [
    "%%%warm and curious%%% So tell me about yourself. Not the resume, I read the resume. Tell me what you'd do with a free Saturday.",
    "%%%interested%%% That's a good answer. Most people say something about hiking that I don't believe. You said naps and I believe you.",
    "%%%friendly%%% Okay. I like you. Let's talk about the actual job, but I'll tell you now, you're doing fine.",
  ],
  // ── the first day of school ──────────────────────────────────────────────
  [
    "%%%fond and a little emotional%%% She walked in without looking back. New backpack, new shoes, not a single glance over her shoulder.",
    "%%%amused%%% I was the one crying in the car. Me. She's fine. She's probably already in charge of something.",
    "%%%warm%%% Three o'clock feels a long way off. I'm going to go buy something for dinner she likes and pretend that's for her.",
  ],
  // ── the busted phone ─────────────────────────────────────────────────────
  [
    "%%%exasperated and amused%%% My phone screen is cracked in a pattern that looks a lot like the state of Texas. I dropped it once. Once.",
    "%%%resigned%%% It still works. I just read everything through Texas now. The panhandle's right over the clock.",
    "%%%practical%%% I'll get it fixed next week. Until then, if my texts have typos, blame the Rio Grande.",
  ],
  // ── the compliment to a stranger ─────────────────────────────────────────
  [
    "%%%friendly and open%%% Excuse me, I just have to say, that jacket is fantastic. Where did you find that?",
    "%%%delighted%%% A thrift store? Of course it was. The good stuff always is. You've got the eye.",
    "%%%warm%%% Anyway, that's all. I just needed you to know somebody noticed. Have a good one.",
  ],
  // ── the family recipe argument ───────────────────────────────────────────
  [
    "%%%mock indignant%%% No. No, she did not use cinnamon. I stood in that kitchen for thirty years and there was never cinnamon.",
    "%%%amused and stubborn%%% You're thinking of the other one. The one with the raisins. This one is plain and it's perfect plain.",
    "%%%conciliatory and warm%%% Fine. Make it your way. I'll make it the right way. We'll have two and let everybody decide.",
  ],
  // ── the retirement ───────────────────────────────────────────────────────
  [
    "%%%happy and a little unsure%%% So. First Monday of not going in. I woke up at five anyway, made coffee, and then just stood there in the kitchen.",
    "%%%amused%%% I organized the spice rack. Alphabetically. That's where I'm at.",
    "%%%warm and hopeful%%% I think I'm going to like this once I figure out what to do with my hands. Come over. Teach me how to do nothing.",
  ],
  // ── the flat soda ────────────────────────────────────────────────────────
  [
    "%%%mildly betrayed%%% I opened a brand new bottle of soda and it was flat. Brand new. Sealed. Flat as a pancake.",
    "%%%amused%%% I drank it anyway, because I'm not going to let a bottle of soda win, but I want it on record that I was wronged.",
    "%%%easygoing%%% Anyway, that's my big news. What's yours. Please have better news than the soda.",
  ],
  // ── the garden thief ─────────────────────────────────────────────────────
  [
    "%%%mock outraged%%% Something is eating my strawberries. Every morning, two or three more gone, and just the ripe ones. It has taste.",
    "%%%amused%%% I put up a net. It got under the net. I put up a second net. I think it's laughing at me.",
    "%%%resigned and fond%%% I've decided it's a very small neighbor and I'm sharing. But I'm getting the first ripe one tomorrow if I have to sleep out there.",
  ],
  // ── the old car ──────────────────────────────────────────────────────────
  [
    "%%%fond%%% The old truck turned two hundred thousand miles today. I pulled over to watch the numbers roll. It felt like it deserved that.",
    "%%%amused%%% It's got a rattle I've never found, a door that only opens from the inside, and a radio that only gets one station.",
    "%%%warm%%% I'm not replacing it. You don't replace a truck like that. You just keep saying thank you and changing the oil.",
  ],
  // ── the surprise party ───────────────────────────────────────────────────
  [
    "%%%conspiratorial and excited%%% Okay, everybody's coming at six, she thinks it's just dinner, and the cake is in the neighbor's fridge so she doesn't find it.",
    "%%%worried and amused%%% The only weak link is her brother, who cannot keep a secret to save his life. I told him it's Wednesday. It's Saturday.",
    "%%%warm%%% She's going to cry. Happy crying, the good kind. Bring tissues and park down the street.",
  ],
  // ── the last box ─────────────────────────────────────────────────────────
  [
    "%%%tired and satisfied%%% That's the last box. Everything's in. Not put away, but in, and that's a different thing, and I'm counting it.",
    "%%%amused%%% I can't find the coffee maker or the forks, so tomorrow morning is going to be interesting.",
    "%%%warm and content%%% But I'm sitting on the floor of my own place with a sandwich, and it feels like mine already.",
  ],
  // ── the church supper ────────────────────────────────────────────────────
  [
    "%%%warm and neighborly%%% The supper's at the hall Thursday. Bring a dish if you can, bring yourself if you can't. Nobody's checking.",
    "%%%amused%%% There'll be four kinds of macaroni and one salad, and the salad will go home untouched, same as every year.",
    "%%%fond%%% Save me a seat near the door. I like to be first to the pie and I'm not ashamed.",
  ],
  // ── the voice memo ───────────────────────────────────────────────────────
  [
    "%%%casual%%% Hey, it's me, don't call back, just listen. I'm at the store and I can't remember if you said the big bag of rice or the little one.",
    "%%%deciding%%% I'm getting the big one. If it was the little one, we'll have rice for a year, and that's a fine problem.",
    "%%%warm%%% Okay. Home in twenty. Put the kettle on if you're there.",
  ],
  // ── the tooth fairy ──────────────────────────────────────────────────────
  [
    "%%%conspiratorial and careful%%% Okay, he's asleep. The tooth's under the pillow. Do we have any cash? I've got a twenty and that's not happening.",
    "%%%amused and a little panicked%%% I looked in the car, I looked in the coat pockets, I found three quarters and a button.",
    "%%%relieved%%% Found a five in the junk drawer. Crisis averted. The tooth fairy is solvent for one more night.",
  ],
  // ── the neighbor's music ─────────────────────────────────────────────────
  [
    "%%%amused and tolerant%%% The neighbor's learning the trumpet. I know this because I've heard the same six notes every night this week at seven fifteen.",
    "%%%fond%%% He's getting better, though. The fifth note used to be a disaster and now it's just questionable.",
    "%%%warm%%% I'm going to leave a note on his door. Something nice. Keep going. Maybe close the window.",
  ],
  // ── batch three (Part 117.6, her word: hand-written only, toward a thousand) ─
  // ── the county fair ──────────────────────────────────────────────────────
  [
    "%%%happy and a little worn out%%% We did the whole fair. Every barn, every ride the kids were tall enough for, and one funnel cake that I'm still wearing on my shirt.",
    "%%%amused%%% There was a goat that ate a corner of my program. Just walked up and took it. Very polite about it.",
    "%%%content%%% I'm sunburned, I'm broke, and I already want to go back tomorrow. That's a good fair.",
  ],
  // ── the power bill ───────────────────────────────────────────────────────
  [
    "%%%mildly outraged%%% Have you seen the power bill? I opened it and had to sit down. I didn't know we had that many lights.",
    "%%%determined%%% So new rules. Nobody runs the air with the windows open. Nobody leaves the porch light on all night for the moths.",
    "%%%amused and resigned%%% I say this every August and by September I've forgotten. But this time I mean it. Probably.",
  ],
  // ── jury duty ────────────────────────────────────────────────────────────
  [
    "%%%resigned and amused%%% So I got called for jury duty. Third time. I think they've got my name on a list somewhere with a star next to it.",
    "%%%matter of fact%%% I sat in a room with forty strangers and a vending machine for six hours, and then they sent us all home.",
    "%%%easygoing%%% I did finish my book, though. So the county owes me nothing. We're square.",
  ],
  // ── new glasses ──────────────────────────────────────────────────────────
  [
    "%%%amazed%%% I got the new glasses and I can see leaves. Individual leaves. On trees. I didn't know that was a thing people were seeing all the time.",
    "%%%amused and a little embarrassed%%% I've apparently been walking around in a watercolor for about two years and just thought that's what outside looked like.",
    "%%%delighted%%% Anyway, you have freckles. Did you know that? I'm going to go look at everything now.",
  ],
  // ── teaching someone to drive ────────────────────────────────────────────
  [
    "%%%calm on purpose%%% Okay. Foot on the brake. Both hands. We're going to go around the parking lot one time and then we'll talk about the road.",
    "%%%amused and a little tense%%% That was a curb. That's fine. Curbs are there to be found. Now you know where it is.",
    "%%%warm and proud%%% You did good. You did actually good. Same time tomorrow, and I'll bring the coffee this time instead of gripping the door handle.",
  ],
  // ── the library ──────────────────────────────────────────────────────────
  [
    "%%%pleased%%% I went to the library for one book and came home with seven, and I don't feel bad about a single one of them.",
    "%%%fond%%% The lady at the desk knows me now. She had one set aside she thought I'd like, and she was right, and I read the first chapter in the parking lot.",
    "%%%content%%% So that's my weekend. A stack of books and the good chair. Don't call unless something's on fire.",
  ],
  // ── the hose fight ───────────────────────────────────────────────────────
  [
    "%%%grinning%%% So I was watering the tomatoes, minding my business, and a certain nine-year-old came up behind me with a bucket.",
    "%%%mock outraged%%% A whole bucket. Down the back of my shirt. On a Tuesday.",
    "%%%delighted%%% So naturally I turned the hose on her, and then her brother, and then the dog got involved, and now everybody's soaked and nobody's sorry.",
  ],
  // ── the broken zipper ────────────────────────────────────────────────────
  [
    "%%%exasperated%%% The zipper on my good jacket went. Right at the bottom, right as it got cold, the way these things do.",
    "%%%thoughtful%%% I looked it up and apparently you can fix it with a fork and some patience. I have the fork.",
    "%%%amused%%% I'll let you know how the patience goes. Bring a needle just in case.",
  ],
  // ── the choir ────────────────────────────────────────────────────────────
  [
    "%%%happy%%% Choir practice was good tonight. We finally got the hard part of the new one, the bit where the parts split and everybody used to panic.",
    "%%%fond%%% The bass section still comes in a beat late every time, but they do it together now, so it sounds like a choice.",
    "%%%warm%%% Come Sunday. We're doing it at the end, and I'll be the one in the second row trying not to look at you and laugh.",
  ],
  // ── the piano lesson ─────────────────────────────────────────────────────
  [
    "%%%patient and encouraging%%% Okay, again from the top. Slower is fine. Nobody's timing you.",
    "%%%pleased%%% There. Hear that? That was the whole line, no stops. Do it one more time so your hands remember.",
    "%%%warm%%% That's enough for today. Go get a snack. You earned the snack.",
  ],
  // ── the snow day ─────────────────────────────────────────────────────────
  [
    "%%%delighted%%% School's closed. Everything's closed. The whole town just got a day off it didn't plan for.",
    "%%%cozy and content%%% We've got pancakes going, the kids are outside building something that's either a fort or a hazard, and I'm not going anywhere.",
    "%%%warm%%% Come over if you can get your car out. If you can't, that's even better. Stay in. Nobody's keeping score today.",
  ],
  // ── the toast rehearsal ──────────────────────────────────────────────────
  [
    "%%%nervous and hopeful%%% Okay, I've got the toast down to about two minutes. Can I try it on you? Be honest, but be kind, I'm fragile.",
    "%%%relieved%%% You laughed at the right spot. Good. That's the spot I was worried about.",
    "%%%warm%%% I'm going to cry at the end, we both know that. I'll just aim it at the cake and keep going.",
  ],
  // ── the bus ──────────────────────────────────────────────────────────────
  [
    "%%%easygoing%%% I took the bus today instead of driving, and I forgot how much I like it. Somebody else does the driving and I just look out the window.",
    "%%%amused%%% A man two rows up had a full conversation with a pigeon that was riding along outside. The pigeon kept up for three stops.",
    "%%%content%%% I might do it more. I got a whole chapter read and nobody honked at me.",
  ],
  // ── the thrift store ─────────────────────────────────────────────────────
  [
    "%%%delighted%%% You have to see what I found at the thrift store. A whole set of Christmas dishes, the ones with the holly on the rim, for six dollars.",
    "%%%conspiratorial%%% There's a chip on one cup. I'm going to put that cup at the head of the table so nobody else gets it. That's the price of being in charge.",
    "%%%warm%%% We're using them this year. All of them. Even the gravy boat nobody knows how to hold.",
  ],
  // ── canning ──────────────────────────────────────────────────────────────
  [
    "%%%tired and satisfied%%% Forty jars. Forty jars of tomatoes, cooling on every flat surface in this kitchen, and the whole house smells like August.",
    "%%%fond%%% I heard the first lid pop while I was washing up and I actually said yes out loud to nobody.",
    "%%%warm%%% Come get a few. Take a dozen. I did this so people could have tomatoes in January, not so I could look at them.",
  ],
  // ── the parade ───────────────────────────────────────────────────────────
  [
    "%%%cheerful%%% The parade was the same as every year, which is exactly why I go. Fire truck, high school band, the tractor club, a lot of candy thrown with real force.",
    "%%%amused%%% The mayor waved from a convertible that stalled twice. He waved through both stalls. Professional.",
    "%%%content%%% We sat on the curb with the lawn chairs and got a sunburn in the same shape as last year. Tradition.",
  ],
  // ── the thunderstorm nap ─────────────────────────────────────────────────
  [
    "%%%peaceful%%% There's a storm rolling in and I've got the window cracked and a blanket, and I'm about to have the best nap of my life.",
    "%%%amused%%% The dog's under the bed already. She's been through a lot of storms. She has a system.",
    "%%%warm%%% If you need me in the next hour, you don't. Whatever it is, it'll keep.",
  ],
  // ── the first paycheck ───────────────────────────────────────────────────
  [
    "%%%proud and a little amazed%%% First paycheck. I'm holding it. It's real, it's got my name on it, and it's smaller than I thought and I don't even care.",
    "%%%thoughtful%%% I'm putting most of it away. I read that's what you do. But I'm buying one thing that's just for me first.",
    "%%%happy%%% It's a good pair of boots. I've been wearing the same ones for three winters. The new ones don't leak. That's the whole dream.",
  ],
  // ── the funeral ──────────────────────────────────────────────────────────
  [
    "%%%gentle and steady%%% The service was nice. Simple, the way he would have wanted. His brother told the story about the fishing boat and everybody laughed, even his wife.",
    "%%%tender%%% Afterwards there was so much food nobody knew where to put it. That's how you know a person was loved. Nobody can find the counter.",
    "%%%warm%%% I'm going to go by and check on her tomorrow. Not to do anything. Just to sit for a while.",
  ],
  // ── the reunion ──────────────────────────────────────────────────────────
  [
    "%%%amused and fond%%% The reunion was exactly what you'd expect. Everybody's grayer, everybody's got the same laugh, and the same two people were still not speaking.",
    "%%%warm%%% The guy who sat behind me in math came up and remembered my name before I remembered his. I bluffed for a solid minute.",
    "%%%content%%% We stayed till they turned the lights on. I'd do it again in another ten years. Maybe five.",
  ],
  // ── learning to swim ─────────────────────────────────────────────────────
  [
    "%%%proud and a little shy%%% So I've been taking swimming lessons. At my age. Tuesday nights, with a bunch of eight-year-olds who are very supportive.",
    "%%%amused%%% I floated on my back tonight for the first time. A whole minute. One of the kids clapped.",
    "%%%determined%%% Next week we do the deep end. I'm scared and I'm going. Both things at once.",
  ],
  // ── cleaning the gutters ─────────────────────────────────────────────────
  [
    "%%%matter of fact%%% Gutters are done. There was a whole ecosystem up there. Leaves, a tennis ball, and I'm pretty sure a family of something moved out while I was on the ladder.",
    "%%%grateful%%% Thanks for holding the ladder. I know you had better things to do than watch me swear at a downspout for an hour.",
    "%%%warm%%% Dinner's on me. Something that didn't come out of a gutter.",
  ],
  // ── the mouse ────────────────────────────────────────────────────────────
  [
    "%%%unsettled and amused%%% There's a mouse in the pantry. I know because he left me a note in the flour. Little footprints, right across the bag.",
    "%%%determined%%% I set the trap with peanut butter. I've been told that's the good stuff. We'll see if he's got taste.",
    "%%%easygoing%%% If he's still there in the morning, he's paying rent. I'll draw up something.",
  ],
  // ── the wallet returned ──────────────────────────────────────────────────
  [
    "%%%relieved and moved%%% Somebody found my wallet. Turned it in at the gas station with everything in it. Cards, cash, the picture of the dog.",
    "%%%warm%%% They didn't leave a name. The kid at the counter just said a lady in a green truck. That's all I've got.",
    "%%%grateful%%% So if you see a lady in a green truck, tell her thank you. And that the dog says hi.",
  ],
  // ── the vet ──────────────────────────────────────────────────────────────
  [
    "%%%relieved%%% Vet says she's fine. It was just a bad tooth. One bad tooth and two hundred dollars, and now she's home eating soft food like a queen.",
    "%%%fond%%% She was so brave. She shook the whole way there and then let the doctor do whatever she wanted. Braver than me.",
    "%%%warm%%% She's asleep on the good pillow now. I'm not moving her. She's earned it.",
  ],
  // ── the bake sale ────────────────────────────────────────────────────────
  [
    "%%%cheerful%%% The bake sale's Saturday and I signed up for cookies, which I regret, because that means I need to make about a hundred.",
    "%%%amused%%% I made a test batch tonight. The kids ate half. So it's less a test batch and more a warning.",
    "%%%warm%%% Come by the table. Buy a dozen. Tell people they're good even if they're not. It's for the band.",
  ],
  // ── the porch swing ──────────────────────────────────────────────────────
  [
    "%%%proud%%% Fixed the porch swing. New chains, two new boards, and I sanded the whole thing down so it doesn't bite you anymore.",
    "%%%content%%% I sat on it for an hour just to make sure it holds. Very thorough testing. Had a glass of tea and everything.",
    "%%%warm%%% It's your turn next. Come sit. It's got that creak back, the good one.",
  ],
  // ── the school play ──────────────────────────────────────────────────────
  [
    "%%%proud and amused%%% He was a tree. In the school play. A tree with one line, and he delivered it like it was the whole show.",
    "%%%fond%%% He forgot the line, actually. Just stood there. And then he said something better, and the whole room laughed, and he took a bow.",
    "%%%warm%%% We got ice cream after. He wore the costume to the ice cream place. Branches and all.",
  ],
  // ── the license office ───────────────────────────────────────────────────
  [
    "%%%resigned and amused%%% Three hours at the license office. Three. I had number two hundred and eight and they were on forty when I sat down.",
    "%%%matter of fact%%% I made friends with the guy next to me. We shared a bag of pretzels. I know about his divorce now.",
    "%%%relieved%%% But I got it. Picture's terrible. It looks like I've been there three hours, which I had.",
  ],
  // ── the hike ─────────────────────────────────────────────────────────────
  [
    "%%%tired and happy%%% We made it to the top. It took two hours longer than the sign said and I stopped more times than I'm going to admit.",
    "%%%awed%%% But you can see three counties from up there. The river looks like a ribbon somebody dropped.",
    "%%%content%%% My legs are going to have opinions tomorrow. Worth it. Every step.",
  ],
  // ── the fireworks ────────────────────────────────────────────────────────
  [
    "%%%excited%%% We've got the blanket, we've got the bug spray, we've got the good spot by the water before anybody else got there.",
    "%%%fond%%% The kids are already asking when it starts. It starts when it's dark. It's been not dark for an hour and they've asked eleven times.",
    "%%%warm%%% Sit down. Have a sandwich. The best part is the waiting anyway.",
  ],
  // ── the christmas lights ─────────────────────────────────────────────────
  [
    "%%%determined and a little grumpy%%% Lights are going up today. I said that last weekend too, but today the ladder's already out, so it's real.",
    "%%%exasperated and amused%%% Half the strand doesn't work. It worked in the box. It's been in the box since January doing nothing but breaking.",
    "%%%pleased%%% Okay. It's up. It's crooked and one corner blinks and it's perfect. Come look before I change my mind.",
  ],
  // ── the dishwasher ───────────────────────────────────────────────────────
  [
    "%%%rueful%%% The dishwasher died. Mid-cycle. Just stopped and sat there full of water like it had given up on life.",
    "%%%matter of fact%%% So we're washing by hand for a while. I wash, you dry, like it's nineteen eighty and we're in a movie.",
    "%%%warm%%% It's kind of nice, though. You talk more with your hands in the sink. Nobody's looking at a phone.",
  ],
  // ── the campfire ─────────────────────────────────────────────────────────
  [
    "%%%content%%% The fire's finally going right. Took three tries and a lot of newspaper, but look at it now.",
    "%%%amused%%% Somebody already burned a marshmallow to a crisp and ate it anyway. Somebody always does. This year it was me.",
    "%%%warm%%% Pull your chair up. We've got all night and nobody has anywhere to be.",
  ],
  // ── the bike ride ────────────────────────────────────────────────────────
  [
    "%%%happy%%% I dug the bike out of the shed. Pumped up the tires, oiled the chain, and rode to the end of the road and back like I was twelve.",
    "%%%amused%%% My legs remembered before my brain did. The first hill, though. The first hill had some things to say.",
    "%%%warm%%% Get yours out. We'll go down by the creek Sunday. I'll bring the sandwiches if you bring the bandaids.",
  ],
  // ── the card game ────────────────────────────────────────────────────────
  [
    "%%%playful%%% Okay, deal me in. And before anybody says anything, I know I lost last week. I've been practicing.",
    "%%%mock suspicious%%% Who shuffled these? These feel shuffled by somebody who wanted me to lose.",
    "%%%delighted%%% And that's the hand. Read them and weep. I'll take my winnings in cookies.",
  ],
  // ── the tax refund ───────────────────────────────────────────────────────
  [
    "%%%pleased%%% The refund came in. It's not a lot, but it's more than I expected, and I've already spent it four different ways in my head.",
    "%%%thoughtful%%% Realistically it's going to the water heater. The water heater has been making a noise. But I'm going to dream about a beach for one more day.",
    "%%%warm%%% Okay. Water heater. And one nice dinner out. That's the compromise and I'm at peace with it.",
  ],
  // ── the chickens ─────────────────────────────────────────────────────────
  [
    "%%%amused%%% The neighbors got chickens. Six of them. And one of them has decided the fence is a suggestion.",
    "%%%fond%%% She's in my yard every morning, scratching around under the bird feeder like she pays taxes here.",
    "%%%warm%%% They brought over a dozen eggs as an apology. Best apology I've ever gotten. She can stay.",
  ],
  // ── the roadside stand ───────────────────────────────────────────────────
  [
    "%%%delighted%%% There's a stand out on the county road with a hand-painted sign that just says peaches, and I stopped, and I'm not sorry.",
    "%%%fond%%% A kid took my money and gave me change out of a coffee can. I got a paper sack of the best peaches I've had in years.",
    "%%%content%%% I ate one in the car. Over the steering wheel. Juice everywhere. No regrets.",
  ],
  // ── moving the piano ─────────────────────────────────────────────────────
  [
    "%%%determined%%% Okay, the piano's going in the front room. It's been in the hall for three years because that's where the movers dropped it, and I'm done walking around it.",
    "%%%strained and amused%%% Lift with your legs. Lift with your legs. Why is it heavier on this end. Nobody said it would be heavier on this end.",
    "%%%relieved and proud%%% It's in. It's crooked but it's in. Nobody touch it for a year.",
  ],
  // ── the lake house ───────────────────────────────────────────────────────
  [
    "%%%relaxed%%% We got up to the lake late but we're here. The dock's still standing, the loons are still out there, the fridge smells like it always does.",
    "%%%content%%% I'm going to sit on the end of the dock with my feet in the water until my feet go numb. That's the plan for the whole day.",
    "%%%warm%%% Drive up if you can. There's a bed. There's always a bed.",
  ],
  // ── the first frost ──────────────────────────────────────────────────────
  [
    "%%%matter of fact%%% First frost last night. Everything in the garden's done except the kale, which apparently doesn't care about anything.",
    "%%%wistful and fond%%% I pulled the last tomatoes green. They'll ripen on the windowsill, some of them. The rest I'll fry.",
    "%%%content%%% It's soup season now. I'm fine with that. I was ready.",
  ],
  // ── the fridge smell ─────────────────────────────────────────────────────
  [
    "%%%determined%%% Something in the fridge has gone bad and I'm going to find it if I have to take out every shelf.",
    "%%%amused and horrified%%% It was a container of something in the back. I don't know what it was. I don't know when it was. It's outside now.",
    "%%%relieved%%% The fridge is clean. It's emptier than it's been in years. I feel like a new person with no leftovers.",
  ],
  // ── mowing ───────────────────────────────────────────────────────────────
  [
    "%%%content%%% Got the whole yard mowed before the heat came in. Straight lines, even, like a ballpark.",
    "%%%amused%%% The mower stalled twice and I talked to it both times. It responds to encouragement. It's a very emotional mower.",
    "%%%pleased%%% Come look at the lines before the dog runs through them. I've got about ten minutes.",
  ],
  // ── the bookshelf ────────────────────────────────────────────────────────
  [
    "%%%proud%%% Built the bookshelf. From boards. Actual boards, with a saw and everything, not a box with a little wrench.",
    "%%%amused%%% It leans a little to the left. I'm calling it character. Books don't mind a lean.",
    "%%%happy%%% It's full already. Turns out I had a lot of books on the floor pretending to be a pile on purpose.",
  ],
  // ── karaoke ──────────────────────────────────────────────────────────────
  [
    "%%%grinning%%% I sang last night. In public. At the place with the little stage and the sticky floor.",
    "%%%amused%%% I picked a song I thought I knew and found out at the second verse that I only knew the chorus. I hummed with confidence.",
    "%%%delighted%%% People clapped. Politely, but they clapped. I'm going back next week and I'm learning the verses.",
  ],
  // ── quilting ─────────────────────────────────────────────────────────────
  [
    "%%%content%%% I finished the quilt. Two years of Sunday afternoons and it's done, and it's on the bed, and it's the best thing I've ever made.",
    "%%%fond%%% There's a square in there from your old flannel shirt. The blue one. I didn't tell you I saved it.",
    "%%%warm%%% Come see it. Then come sleep under it. That's what it's for.",
  ],
  // ── the pen pal ──────────────────────────────────────────────────────────
  [
    "%%%pleased and surprised%%% I got a letter. An actual letter, in the mail, with a stamp. From the friend I used to write to when we were kids.",
    "%%%warm and nostalgic%%% Her handwriting hasn't changed. Same loops on the y's. It took me right back to being eleven.",
    "%%%happy%%% I'm writing back tonight. On paper. I had to go buy envelopes. I didn't own envelopes.",
  ],
  // ── the fishing license ──────────────────────────────────────────────────
  [
    "%%%cheerful%%% Got my fishing license renewed. That's the official start of the season as far as I'm concerned, whatever the calendar says.",
    "%%%amused%%% The guy at the counter asked if I'd caught anything last year. I said that's not really what it's about. He nodded like he'd heard that before.",
    "%%%warm%%% Sunday morning. The spot by the bridge. I'll bring the thermos, you bring the excuses.",
  ],
  // ── the tea ──────────────────────────────────────────────────────────────
  [
    "%%%warm and unbothered%%% Kettle's on. I don't care what kind of day you've had, you're having a cup of tea before you say a word about it.",
    "%%%gentle%%% There. Sit. Hold it with both hands. That's half of what tea is for.",
    "%%%fond%%% Okay. Now tell me. Start wherever.",
  ],
  // ── batch four (Part 117.7). Her word: "they don't all have to be super
  //    long… some can be way shorter as long as it's more than 2 short
  //    sentences." So this batch mixes one-, two- and three-paragraph scripts. ─
  // ── short ones ───────────────────────────────────────────────────────────
  [
    "%%%warm and easy%%% You made it. Get in here, it's freezing. I saved you the chair by the heater and nobody's allowed in it but you.",
  ],
  [
    "%%%amused%%% The cat knocked a full glass of water off the counter. Looked me dead in the eye. Walked away. I've never felt so judged in my own kitchen.",
  ],
  [
    "%%%pleased%%% Guess who fixed the lamp. The one that's been flickering since spring. It was the plug. It was always the plug.",
  ],
  [
    "%%%sympathetic%%% Oh no. Oh, that's rough. Okay, well, first thing, have you eaten anything today? Because that's step one and you skipped it.",
  ],
  [
    "%%%delighted%%% They had the good bread. The one with the seeds on top. I bought two and I'm not sharing the second one.",
  ],
  [
    "%%%curious%%% Wait, go back. What did she say when you told her? No, the exact words. I need the exact words.",
  ],
  [
    "%%%fond%%% He fell asleep in the car with the ice cream still in his hand. Didn't drop it. Didn't spill a drop. That's talent.",
  ],
  [
    "%%%dry%%% The meeting could have been a text. It was forty minutes. The text would have been nine words.",
  ],
  [
    "%%%relieved%%% Found the remote. It was in the fridge. I'm not going to explain that because I can't.",
  ],
  [
    "%%%hopeful%%% I think the rain's letting up. I can see a little strip of blue over the barn. Give it ten minutes and we'll go.",
  ],
  [
    "%%%teasing%%% You wore that shirt on purpose, didn't you. You knew I'd say something. Well. I'm saying something. It looks good.",
  ],
  [
    "%%%content%%% Sunday morning. Coffee's hot, the paper's on the step, and nobody needs me for anything until noon. This is the whole reason for the week.",
  ],
  // ── two-paragraph ones ───────────────────────────────────────────────────
  [
    "%%%sheepish%%% So I might have signed us up for the chili cookoff. Both of us. As a team.",
    "%%%hopeful and playful%%% It's in three weeks. You make the chili, I'll make the sign. That's a fair split, right? I'm very good at signs.",
  ],
  [
    "%%%worried%%% The check engine light came on again. Same as last month. I thought we fixed that.",
    "%%%resigned and amused%%% I put a piece of tape over it. I know. I know. But it's quieter in here now, emotionally.",
  ],
  [
    "%%%excited%%% The seeds came up. All of them, in one night, like they'd been waiting for a signal.",
    "%%%fond%%% I went out this morning and there was this whole line of little green things standing up in the dirt. I said good morning to them. Out loud.",
  ],
  [
    "%%%tired%%% Long day. Long, long day. The kind where you get home and just stand in the kitchen for a minute with your keys still in your hand.",
    "%%%warm%%% But you're here, and there's soup, and the day is over whether it likes it or not. Sit.",
  ],
  [
    "%%%proud%%% She read the whole book by herself. The whole thing. Cover to cover, and then she came and told me the ending like I hadn't already read it forty times.",
    "%%%delighted%%% Now she wants the next one. Tonight. I'm going to the library on my lunch break like a person on a mission.",
  ],
  [
    "%%%mock serious%%% We need to talk about the thermostat. Somebody keeps moving it to sixty-four. I'm not naming names. I'm looking right at the person.",
    "%%%amused%%% Sixty-eight. That's the deal we made. I have it in writing. I have it on the fridge.",
  ],
  [
    "%%%wistful%%% The old diner closed. The one with the pie case by the register and the booths that were always a little sticky.",
    "%%%fond%%% I had my first cup of coffee in that place. Terrible coffee. I'd give anything for one more cup of it.",
  ],
  [
    "%%%pleased%%% I finally beat him at chess. Twenty years of losing and tonight I got him. He saw it coming three moves out and couldn't do a thing.",
    "%%%grinning%%% He wants a rematch. He'll get one. Next year. I'm going to enjoy this for a while.",
  ],
  [
    "%%%gentle%%% Hey. I know you didn't want to talk about it, so I'm not going to make you. I'm just going to sit here.",
    "%%%warm%%% And if at some point you want to say something, I'll be right here when you do. I'm not in a hurry.",
  ],
  [
    "%%%amazed%%% The hummingbirds are back. Three of them, fighting over the one feeder like it's the last one on earth.",
    "%%%content%%% I put out a second feeder. They're fighting over that one now too. It's fine. It's how they say hello.",
  ],
  [
    "%%%determined%%% I'm going to learn to make bread. Real bread. The kind you have to wait for.",
    "%%%amused and honest%%% The first loaf is going to be terrible. I know that going in. The second one might be okay. Come by for the third.",
  ],
  [
    "%%%delighted%%% The lightning bugs are out. First ones of the year, down by the fence line, blinking like they've got somewhere to be.",
    "%%%warm%%% Come out on the porch. Bring the kids. This only lasts a few weeks and then it's gone till next June.",
  ],
  // ── three-paragraph ones ─────────────────────────────────────────────────
  [
    "%%%cheerful%%% So the plumber came, finally, and he looked at the pipe under the sink for about four seconds and said, well, there's your problem.",
    "%%%amused%%% It was a sock. A sock, in the pipe. I don't know whose. I don't know how. He didn't ask and I didn't offer.",
    "%%%relieved%%% Anyway, the sink drains now, and I've decided not to think about the sock ever again.",
  ],
  [
    "%%%curious%%% Okay, tell me about the new place. Is it the one with the porch or the one with the weird kitchen?",
    "%%%pleased%%% The porch. Good. The porch is the one I'd have picked. You can put a swing on a porch. You can't put a swing on a weird kitchen.",
    "%%%warm%%% I'll help you move. I'm not carrying the couch, but I'll carry everything else and I'll bring the good tape.",
  ],
  [
    "%%%worried and trying not to be%%% He's late. He's never late. He said six and it's six forty and he's not answering.",
    "%%%relieved and a little shaky%%% Oh, there he is. His phone died and he stopped for gas. He's fine. He's completely fine.",
    "%%%exasperated and warm%%% I'm going to hug him and then I'm going to yell at him and then I'm going to hug him again. In that order.",
  ],
  [
    "%%%happy%%% We finally got the garden fenced. Took all weekend, and I've got blisters in places I didn't know could blister.",
    "%%%amused%%% The rabbits watched the whole time. Sat right there at the edge of the yard like foremen. Very unimpressed.",
    "%%%content%%% But it's up. The lettuce has a fighting chance now. Come see it before the rabbits figure out the gate.",
  ],
  [
    "%%%matter of fact%%% The tree guy came out about the oak. He says it's got maybe five good years left, and after that it's coming down whether we like it or not.",
    "%%%wistful%%% That tree's been there longer than the house. There's a swing scar on the big branch from before we moved in.",
    "%%%warm and practical%%% So we've got five years. That's five more summers under it. I'm going to use every one.",
  ],
  [
    "%%%pleased and surprised%%% The kid across the street shoveled our walk. Didn't ask, didn't knock, just did it before we were even up.",
    "%%%fond%%% I caught him on the way back and tried to give him something and he wouldn't take it. Said his mom would kill him.",
    "%%%warm%%% So I'm making a pie and leaving it on their step. His mom can't kill him for a pie.",
  ],
  [
    "%%%amused and a little tired%%% Three loads of laundry, a sink full of dishes, and somehow there's still a mystery sticky spot on the floor I can't find.",
    "%%%determined%%% I'm going to find it. I'm going to get down on my hands and knees and I'm going to find it.",
    "%%%relieved and grossed out%%% It was honey. Under the chair. Don't ask how. Nobody in this house has an answer.",
  ],
  [
    "%%%excited%%% Okay so I finally tried the new place on the corner, and the line was out the door, and it was worth every minute of it.",
    "%%%delighted%%% I got the thing with the eggs on it. I don't know what it was called. It had eggs, it had some kind of green sauce, it had my whole heart.",
    "%%%warm%%% We're going Saturday. Early. I'm not standing in that line twice.",
  ],
  [
    "%%%sincere%%% Hey. I heard about your dad. I'm sorry. I know you two had a complicated thing and I know that doesn't make it easier.",
    "%%%gentle%%% You don't have to feel any particular way about it. Whatever you're feeling is the right amount.",
    "%%%warm%%% I'm around all week. Call, don't call, show up at midnight. Any of it's fine.",
  ],
  [
    "%%%grinning%%% I taught the dog to bring me the newspaper. Took a month. A whole month of standing in the yard saying paper, paper, paper like a lunatic.",
    "%%%amused%%% This morning she brought me the neighbor's paper. So we're close. We're very close.",
    "%%%fond%%% I gave her the treat anyway. She got the concept. The addressing is a detail.",
  ],
  [
    "%%%happy%%% The rain finally came. Two weeks of nothing and then last night the sky just opened up, and I stood on the porch and watched it come down.",
    "%%%content%%% The garden's a different color this morning. Everything's standing up straight again. Even the corn looks smug.",
    "%%%warm%%% Come by. The creek's running. The kids will want to throw sticks in it, and so do I.",
  ],
  [
    "%%%sheepish%%% Remember that plant you gave me? The one you said was impossible to kill?",
    "%%%amused and guilty%%% I found a way. I don't know how. I watered it, I gave it the window, I talked to it. It looked at me one day and gave up.",
    "%%%hopeful%%% I'd like to try again. With a different plant. Maybe one that's used to disappointment.",
  ],
  [
    "%%%proud%%% I ran the whole way today. Didn't stop once. Three miles, and the last hill, the one that always gets me, I just went up it like it wasn't there.",
    "%%%amazed%%% I don't know what happened. Nothing was different. My legs just decided today was the day.",
    "%%%happy%%% I'm going to be insufferable about this for at least a week. Fair warning.",
  ],
  [
    "%%%mock exasperated%%% Somebody ate the last piece of cake and put the empty plate back in the fridge. The empty plate. Back in the fridge.",
    "%%%amused%%% I opened the door with such hope. I saw the plate. I felt the plate's emptiness in my soul.",
    "%%%teasing%%% I'm not mad. I'm just going to bring it up at every meal for the rest of the month.",
  ],
  [
    "%%%warm%%% The kids made breakfast. On their own. Nobody asked them to. I woke up to the smell of something that was mostly toast.",
    "%%%fond and amused%%% The eggs were interesting. The orange juice had pulp in it and we don't buy pulp, so I have questions. But I ate all of it.",
    "%%%tender%%% They were so proud. I'm going to remember that breakfast longer than any fancy one I've ever had.",
  ],
  [
    "%%%cheerful%%% Okay, road trip snacks. I've got the pretzels, the good cheese crackers, the grapes for when we feel guilty, and one bag of the candy nobody admits to liking.",
    "%%%conspiratorial%%% The candy's for me. I've hidden it in the glove box. If you find it, you didn't.",
    "%%%happy%%% Get in. We've got six hours and a playlist that's mostly nineties. Let's go.",
  ],
  [
    "%%%relieved%%% Test results came back. All clear. Every single one. The doctor said keep doing what I'm doing, which is the nicest thing a doctor's ever said to me.",
    "%%%grateful%%% I know I've been quiet the last couple of weeks. That's why. I didn't want to say anything until I knew.",
    "%%%warm%%% So. I'm okay. Let's go get a milkshake. A large one. Doctor's orders, basically.",
  ],
  [
    "%%%amused%%% The new neighbor introduced himself by asking if we'd seen his tortoise. His tortoise. A tortoise named Gary who apparently has wanderlust.",
    "%%%delighted%%% We found Gary. He was under our hydrangea, going at a pace I'd describe as thoughtful.",
    "%%%warm%%% So we've met the neighbors. Via tortoise. It's a good start.",
  ],
  [
    "%%%nostalgic%%% They're tearing down the old high school. I drove past today and half the gym's already gone.",
    "%%%fond%%% I had my first slow dance in that gym. Terrible song. Sweaty hands. I'd go back in a second.",
    "%%%content%%% I took a brick. From the pile. I don't know what I'm going to do with a brick, but it's mine now.",
  ],
  [
    "%%%excited%%% The package came. The one I've been checking the tracking on nine times a day like a person with a problem.",
    "%%%delighted%%% It's the record. The one I've been hunting for two years. The one that never turns up. It turned up.",
    "%%%content%%% I'm putting it on right now and I'm not answering the phone until it's over. Both sides.",
  ],
  [
    "%%%calm and reassuring%%% Okay. Breathe. The stove's off, I checked it twice. The door's locked, I watched you lock it. The cat has food.",
    "%%%gentle and amused%%% You've done this trip a hundred times and the house has never once burned down while you were gone.",
    "%%%warm%%% Go. Have a good time. Text me a picture of the ocean so I can be jealous.",
  ],
  [
    "%%%grinning%%% My uncle fell asleep at the table again. Mid-sentence. He was telling the story about the mule and just stopped.",
    "%%%fond%%% We all sat there for a second and then kept eating like nothing happened. That's how it goes. The story will resume next Thanksgiving.",
    "%%%amused%%% He'll wake up in twenty minutes and finish the sentence. He always does. Same word he left off on.",
  ],
  [
    "%%%determined%%% I'm cleaning out the garage this weekend. All of it. Every box that says miscellaneous is getting opened and dealt with.",
    "%%%amused and honest%%% I said this last spring. And the spring before. But this time I've got a dumpster coming, and a dumpster is a commitment.",
    "%%%hopeful%%% By Sunday night I want to be able to park a car in there. An actual car. Wish me luck.",
  ],
  [
    "%%%happy%%% We got the old truck running. It sat under that tarp for three years and today it turned over on the second try, like it had just been waiting.",
    "%%%fond%%% It still smells like his cigars in there. I rolled the windows down and then I rolled them back up.",
    "%%%warm%%% I'm taking it to the feed store tomorrow. Just because. He'd have liked that.",
  ],
  [
    "%%%curious%%% What's the name of that song? The one from the wedding. The one everybody got up for, even your grandmother.",
    "%%%delighted%%% That's it. That's the one. I've had it stuck in my head for a week and couldn't place it.",
    "%%%amused%%% I'm going to play it in the car now and sing every word wrong. You're welcome to join.",
  ],
  [
    "%%%warm%%% I made your mother's soup. From the card. The one with the coffee ring on it.",
    "%%%honest%%% It's not quite hers. Something's off, and I can't figure out what. Maybe it's the pot. Maybe it's that she's not standing next to me telling me I'm doing it wrong.",
    "%%%tender%%% But it's close. Close enough that the kitchen smelled like her house for a minute. Come have a bowl.",
  ],
  // ── batch five (Part 118, Sep 2 2026) — fifty more, hand-written ──────
  // ── the stray cat ─────────────────────────────────────────────────────
  [
    "%%%amused%%% So the cat that isn't ours has decided the porch is hers. She was there at six this morning like she had an appointment.",
    "%%%fond and a little defeated%%% I gave her the end of the tuna. I know. I know what that means.",
    "%%%warm%%% If she's still there tomorrow we're naming her, and if we name her that's it, she lives here.",
  ],
  // ── the smoke detector chirp ──────────────────────────────────────────
  [
    "%%%irritated but laughing%%% That chirp. Every forty seconds, all night, and of course it's the one in the hallway ceiling that needs the tall ladder.",
    "%%%pleased%%% Got it, though. New battery, no more chirp. The house is quiet and I feel like I won something.",
  ],
  // ── the first tomato ──────────────────────────────────────────────────
  [
    "%%%delighted%%% First tomato of the year. One. It's the size of a golf ball and I'm treating it like a trophy.",
    "%%%thoughtful%%% I'm not sure how to eat it. Salt and a plate feels right. Maybe I'll just stand at the counter and do it there.",
    "%%%hopeful%%% There's about thirty more coming behind it, so by August we'll be begging people to take them.",
  ],
  // ── the dead battery ──────────────────────────────────────────────────
  [
    "%%%sheepish%%% Left the dome light on all night. Again. The car made that clicking sound and I just put my head on the steering wheel for a minute.",
    "%%%grateful%%% The guy next door came over with cables before I even asked. Didn't say a word, just popped his hood.",
    "%%%resolved%%% I'm buying one of those jump packs today. This is the third time and I'm done being rescued.",
  ],
  // ── the laundromat ────────────────────────────────────────────────────
  [
    "%%%content%%% I kind of like the laundromat. Nobody needs anything from me for an hour and the dryers make that big warm hum.",
    "%%%amused%%% There's a guy who folds his shirts like he's in the military and a lady who reads the same paperback every week. We nod. We're regulars.",
  ],
  // ── the wrong drive-through order ─────────────────────────────────────
  [
    "%%%baffled%%% I ordered a coffee and a biscuit and I got a bag with four hash browns and nothing else. Four.",
    "%%%amused%%% I didn't go back. I just sat in the parking lot and ate hash browns like it was a decision I'd made.",
    "%%%easygoing%%% So if you're hungry, I have two left. They're a little cold but they're yours.",
  ],
  // ── the thermostat war ────────────────────────────────────────────────
  [
    "%%%mock serious%%% Somebody in this house set the thermostat to sixty-four last night, and it wasn't me, and it wasn't the dog.",
    "%%%amused%%% I woke up wearing two blankets and a hat. A hat. Indoors.",
    "%%%fond%%% We're going to settle this like adults. Sixty-eight, and the winner gets to say so.",
  ],
  // ── the bird in the house ─────────────────────────────────────────────
  [
    "%%%flustered and laughing%%% There is a bird in the kitchen. A whole bird. It came in through the screen door and now it's sitting on the paper towel holder judging me.",
    "%%%hopeful%%% I've opened every window. I'm holding a broom I don't intend to use. We're waiting each other out.",
  ],
  // ── the sourdough starter ─────────────────────────────────────────────
  [
    "%%%proud%%% The starter is alive. Bubbles and everything. I fed it this morning and it doubled by lunch like it was showing off.",
    "%%%amused%%% I've named it. I'm not going to tell you the name because you'll make a face.",
    "%%%warm%%% First loaf is Saturday. Come over and be impressed, or at least be polite about it.",
  ],
  // ── the flu shot ──────────────────────────────────────────────────────
  [
    "%%%matter of fact%%% Got the flu shot at the pharmacy. Took nine minutes, most of it filling out the same form I fill out every year.",
    "%%%wry%%% The pharmacist told me I'd feel a little sore, and I said I already felt a little sore, and she said that's fair.",
    "%%%content%%% Anyway, arm's fine, I'm fine, and I got a sticker. I'm wearing it.",
  ],
  // ── the cricket ───────────────────────────────────────────────────────
  [
    "%%%tired and amused%%% There's a cricket somewhere in the bedroom and he only sings when I turn off the lamp.",
    "%%%determined%%% Lamp on, silence. Lamp off, concert. We did this six times. I think he's enjoying it.",
    "%%%resigned%%% I'm sleeping on the couch tonight. He can have the room. He clearly needs it more.",
  ],
  // ── the road trip playlist ────────────────────────────────────────────
  [
    "%%%excited%%% I made the playlist for the drive. Four hours, no repeats, and one song at the very end that you're going to have feelings about.",
    "%%%teasing%%% No, I'm not telling you what it is. That's the whole point of the four hours.",
  ],
  // ── the deer in the yard ──────────────────────────────────────────────
  [
    "%%%awed and tender%%% There were three deer in the backyard this morning, just standing there in the fog eating the hostas.",
    "%%%amused and resigned%%% I've spent two summers on those hostas. They didn't even hurry. One of them looked right at me through the window and kept chewing.",
    "%%%warm%%% I'm not even mad. It was so quiet, and they were so calm, and the coffee was hot. Good morning, all around.",
  ],
  // ── the spare key ─────────────────────────────────────────────────────
  [
    "%%%relieved%%% Found the spare key. It was in the flowerpot, where it has always been, where I looked twice before I found it.",
    "%%%sheepish%%% I was standing on the porch in my socks for twenty minutes because the door shut behind me while I was getting the paper.",
    "%%%amused%%% The neighbor waved. I waved. Nobody mentioned the socks. That's the kind of street this is.",
  ],
  // ── the coffee maker died ─────────────────────────────────────────────
  [
    "%%%dramatic and mournful%%% The coffee maker died this morning. Eleven years. It made one sad gurgle and gave up.",
    "%%%grateful%%% I boiled water in a pan and poured it through a filter I held over a mug with my hand, and it was the best coffee I've had in a month.",
    "%%%thoughtful%%% Maybe I don't need a coffee maker. Maybe I just need a pan and some patience. Ask me again tomorrow.",
  ],
  // ── the garage door ───────────────────────────────────────────────────
  [
    "%%%annoyed%%% The garage door has decided it only goes halfway. Halfway up, halfway down, like it's making a point.",
    "%%%amused%%% I can get the car out if I fold the mirrors in and hold my breath. It's a system.",
  ],
  // ── the neighbor's leaf pile ──────────────────────────────────────────
  [
    "%%%fond%%% The kids next door raked a leaf pile taller than the mailbox and then just stood there admiring it.",
    "%%%delighted%%% Then the little one ran and jumped, and the whole pile went everywhere, and the big one yelled, and then he jumped too.",
    "%%%warm%%% That's the whole afternoon, right there. That's what a Saturday is for.",
  ],
  // ── the lost glove ────────────────────────────────────────────────────
  [
    "%%%wistful%%% Lost a glove. Just the left one. The right one's in my pocket waiting like it thinks the other one's coming back.",
    "%%%amused%%% I'll wear the one glove for a week out of loyalty, and then I'll buy a new pair, and then the old one will turn up under the seat.",
  ],
  // ── the sunburn ───────────────────────────────────────────────────────
  [
    "%%%rueful%%% I put sunscreen on everything except the tops of my feet, and now I have two bright red feet and a very good story.",
    "%%%amused%%% I'm walking like the floor is hot. The dog thinks it's a game.",
    "%%%easygoing%%% Worth it, though. The water was perfect and I read a whole book. Ask me about the book, not the feet.",
  ],
  // ── the cheap motel ───────────────────────────────────────────────────
  [
    "%%%amused%%% The motel had a sign that said color television, in this decade, like that's still the selling point.",
    "%%%content%%% The bed was fine. The shower was hot. The guy at the desk gave us directions to a diner that turned out to be the best part of the trip.",
    "%%%fond%%% I'd stay there again. Don't tell anybody I said that.",
  ],
  // ── the wind chimes ───────────────────────────────────────────────────
  [
    "%%%calm and content%%% The wind picked up around four and the chimes on the porch got going, the low ones, the ones that sound like a church a mile away.",
    "%%%tender%%% My grandmother had chimes like that. I used to fall asleep to them on her couch with the screen door open.",
  ],
  // ── the mud room ──────────────────────────────────────────────────────
  [
    "%%%mock exasperated%%% Four pairs of boots, one of them mine. A ball I've never seen before. And a single sock that belongs to nobody in this house.",
    "%%%amused%%% The mud room is not a room. It's a place where things go to be forgotten.",
    "%%%determined%%% Sunday I'm putting in hooks. Everybody gets a hook. Everybody gets a bin. This is a new era.",
  ],
  // ── the leftover chili ────────────────────────────────────────────────
  [
    "%%%pleased%%% The chili is better on the second day. It always is. Something happens in the fridge overnight that I don't understand and don't need to.",
    "%%%warm%%% There's enough for both of us and cornbread if you bring it. That's the deal.",
  ],
  // ── the family group chat ─────────────────────────────────────────────
  [
    "%%%amused%%% The family chat has forty-one messages since lunch and thirty of them are my aunt reacting to her own photo.",
    "%%%fond%%% My brother sent one word. Nice. That's all he ever sends, and somehow it's my favorite message every time.",
    "%%%easygoing%%% I'll catch up tonight. Or I won't and somebody will call me and tell me what I missed, which is faster anyway.",
  ],
  // ── the tire swing ────────────────────────────────────────────────────
  [
    "%%%nostalgic%%% They still have the tire swing on the big oak by the creek. Same rope, or a rope just like it.",
    "%%%amused%%% I got on it. A grown adult, on a tire swing, and it held, and for about four seconds I was nine years old.",
    "%%%tender%%% Then my back reminded me what year it is. But those four seconds were something.",
  ],
  // ── the mailman ───────────────────────────────────────────────────────
  [
    "%%%fond%%% Our mail carrier knows the dog's name and brings him a biscuit. Not us. Him. We're just the people who live where the dog lives.",
    "%%%warm%%% I left a cold water out for her yesterday since it was a hundred and two. She left a note that said thanks with a smiley face. That's a friendship now.",
  ],
  // ── the burnt toast ───────────────────────────────────────────────────
  [
    "%%%rueful%%% Burned the toast. Not a little. The smoke alarm went off and the dog left the room in protest.",
    "%%%amused%%% I scraped it. My mother scraped toast, so I scrape toast. It's a family tradition that nobody chose.",
    "%%%content%%% With enough butter you can't tell. That's true of most things, actually.",
  ],
  // ── the hand-me-down coat ─────────────────────────────────────────────
  [
    "%%%tender%%% My sister's old coat fits me now. It took about twenty years, but it fits.",
    "%%%amused%%% There's a movie ticket in the pocket from before I was born. I'm leaving it there. It's part of the coat.",
  ],
  // ── the pharmacy line ─────────────────────────────────────────────────
  [
    "%%%patient and amused%%% The pharmacy line was nine people, and every single one of us had a question that took five minutes.",
    "%%%fond%%% The man in front of me showed me pictures of his grandbaby while we waited. She has the biggest cheeks I've ever seen on a person.",
    "%%%easygoing%%% Got my prescription, got a new friend, lost forty minutes. Fair trade.",
  ],
  // ── the porch pumpkin ─────────────────────────────────────────────────
  [
    "%%%proud%%% Carved the pumpkin. It's got one big eye and one small eye and a mouth that looks like it's about to say something rude.",
    "%%%delighted%%% The kids across the street love it. They came over just to look at it and tell me it was scary. It is not scary. It looks confused.",
    "%%%warm%%% Anyway, it's on the porch with a candle in it, and the whole street smells like pumpkin guts and October.",
  ],
  // ── the singing in the car ────────────────────────────────────────────
  [
    "%%%amused%%% Got caught singing at the red light. Full voice, hand on the chest, the whole thing.",
    "%%%unbothered%%% The lady in the next car laughed, so I rolled the window down and kept going. She joined in on the chorus.",
    "%%%happy%%% Best red light of my life. I hope she got where she was going.",
  ],
  // ── the rain gauge ────────────────────────────────────────────────────
  [
    "%%%pleased%%% Two inches in the rain gauge overnight. Two. The creek's up and the garden looks like it just got good news.",
    "%%%thoughtful%%% Dad used to check that gauge every morning before coffee. I didn't understand it then. I think I do now.",
  ],
  // ── the cousin's visit ────────────────────────────────────────────────
  [
    "%%%warm%%% My cousin's coming Friday. Haven't seen her since the wedding, and she's bringing the twins, so the house is about to get loud.",
    "%%%amused%%% I've hidden everything breakable and lowered my expectations for sleep.",
    "%%%fond%%% It'll be good. She laughs like our grandmother did, that big one from the belly, and I need to hear it.",
  ],
  // ── the new shoes squeak ──────────────────────────────────────────────
  [
    "%%%embarrassed and amused%%% The new shoes squeak. Every step. I walked into the meeting and everyone looked up like a duck had come in.",
    "%%%resigned%%% I'm told it goes away in a week. I'm told a lot of things.",
  ],
  // ── the gas station coffee ────────────────────────────────────────────
  [
    "%%%content%%% Gas station coffee at five in the morning is a different drink than coffee at any other hour. It's not good. It's right.",
    "%%%fond%%% The man behind the counter says drive safe every single time, and every single time I do.",
    "%%%easygoing%%% Anyway, I'm on the road. I'll be there before lunch if the trucks let me.",
  ],
  // ── the lost remote ───────────────────────────────────────────────────
  [
    "%%%baffled%%% The remote is gone. Not under the cushion, not in the fridge, not in the dog. We checked.",
    "%%%amused%%% We watched the same channel for two days like it was 1985. It was kind of nice. We talked during the commercials.",
    "%%%pleased%%% Found it in the bathroom. Nobody's explaining that one. Nobody's asking.",
  ],
  // ── the ice storm ─────────────────────────────────────────────────────
  [
    "%%%awed%%% Everything's glass this morning. Every branch, every wire, the whole fence line shining like somebody dipped the yard.",
    "%%%careful%%% I'm not going anywhere. The driveway is a rink and the news says the roads are worse.",
    "%%%content%%% So it's soup and the good blanket and whatever's on the radio. Call me if your power goes. I've got the fireplace.",
  ],
  // ── the church pew ────────────────────────────────────────────────────
  [
    "%%%amused%%% Somebody sat in our pew. Third from the back, left side, been ours for thirty years, and a whole family just sat right down in it.",
    "%%%fond%%% Mama didn't say a word. She just sat in the pew in front and sang a little louder than usual.",
  ],
  // ── the dryer lint ────────────────────────────────────────────────────
  [
    "%%%alarmed and amused%%% Pulled the lint trap and it came out like a whole gray sweater. I don't know how long that had been building.",
    "%%%relieved%%% The dryer runs like new now. Twenty minutes instead of an hour. I feel like I fixed something serious.",
    "%%%wry%%% I did fix something serious. That was a fire waiting to happen and I was drying towels on top of it.",
  ],
  // ── the driveway basketball ───────────────────────────────────────────
  [
    "%%%happy%%% The kids put the hoop back up and now there's a basketball hitting the driveway every evening until the streetlight comes on.",
    "%%%nostalgic%%% That sound. That exact sound. That's every summer I ever had.",
    "%%%warm%%% I went out and took a shot last night. Missed by a mile. They let me have another one.",
  ],
  // ── the last of the peaches ───────────────────────────────────────────
  [
    "%%%wistful%%% Last peaches of the season at the stand. The man said next week they'll have apples, like that's supposed to make me feel better.",
    "%%%content%%% I bought too many. I'm eating one over the sink right now, and the juice is down to my elbow, and I regret nothing.",
  ],
  // ── the storm door ────────────────────────────────────────────────────
  [
    "%%%irritated%%% The storm door slams. Every time. It's got that closer thing on it and the closer thing has given up on life.",
    "%%%amused%%% The whole house jumps. The dog jumps. I jump, and I'm the one who opened it.",
    "%%%determined%%% There's a screw you turn. I've been told there's a screw you turn. Tonight I find the screw.",
  ],
  // ── the sleepover ─────────────────────────────────────────────────────
  [
    "%%%fond and tired%%% Four ten-year-olds in the living room, and I said lights out at ten, and at midnight they were still whispering about a ghost.",
    "%%%amused%%% There's no ghost. The ghost is the ice maker.",
    "%%%warm%%% They're all asleep now in a pile like puppies. I'm going to make a hundred pancakes in the morning and be the hero.",
  ],
  // ── the lawn chair ────────────────────────────────────────────────────
  [
    "%%%content%%% Sat in the lawn chair for an hour and did nothing. No phone, no book. Just the chair and the yard and a hawk going around.",
    "%%%thoughtful%%% I can't remember the last time I did that on purpose. I think I'm going to do it again tomorrow.",
  ],
  // ── the crockpot ──────────────────────────────────────────────────────
  [
    "%%%pleased%%% Put the roast in the crockpot at seven this morning, and the house has smelled like Sunday all day even though it's Tuesday.",
    "%%%warm%%% There's carrots and potatoes and the good onions. Come by after six. Bring nothing. I mean it this time.",
  ],
  // ── the yard light ────────────────────────────────────────────────────
  [
    "%%%calm%%% The yard light finally came on by itself tonight. The sensor's been broken since spring and I kept meaning to look at it.",
    "%%%pleased%%% Turns out a wasp nest was covering the little eye. Cleared it, and the light just came on like it had been waiting.",
    "%%%content%%% The whole yard's lit up soft and yellow. The moths are thrilled. I'm a little thrilled too.",
  ],
  // ── the wrong number ──────────────────────────────────────────────────
  [
    "%%%amused%%% Got a wrong number this morning, and instead of hanging up, the lady and I talked for ten minutes about her tomatoes.",
    "%%%warm%%% She's got blossom end rot. I told her about the eggshells. She's going to call me back and let me know.",
    "%%%delighted%%% I have a tomato friend now. I don't know her name. It doesn't matter.",
  ],
  // ── the birthday card late ────────────────────────────────────────────
  [
    "%%%apologetic%%% The card's going to be late. I bought it three weeks ago and it's been sitting on the counter looking at me.",
    "%%%sincere%%% It says the true thing, though. I wrote it out twice to get it right.",
    "%%%fond%%% So when it comes, it's late, but it's not careless. Those are different.",
  ],
  // ── the bird feeder ───────────────────────────────────────────────────
  [
    "%%%delighted%%% Cardinals at the feeder. Two of them, the red one and the brown one, taking turns like they've got manners.",
    "%%%mock outraged%%% And then the squirrel. Upside down, hanging by his feet, eating like he owns the place.",
    "%%%amused and resigned%%% I've bought three squirrel-proof feeders. He has beaten all three. I respect him. I hate him. Both.",
  ],
  // ── the phone charger ─────────────────────────────────────────────────
  [
    "%%%mildly annoyed%%% There are four phone chargers in this house and none of them are where I left them.",
    "%%%amused%%% I found one in the car, one in the bathroom, and one in the dog's bed. The dog is not talking.",
  ],
].map((paras) => paras.join("\n\n"));

const QUICK = [
  "%%%warm and easy%%% Hey, there you are. Come sit down, I just made coffee.",
  "%%%amused%%% The neighbor got a leaf blower. Every Saturday sounds like an airport now.",
  "%%%delighted%%% Wait, they called you back already? That's great, that's really great.",
  "%%%sheepish%%% The keys were in the jacket. The jacket I put on to go look for them.",
  "%%%cheerful%%% It's gorgeous out. Open every window and deal with the wasp later.",
  "%%%fond%%% You look happy. That's what looks good on you.",
  "%%%curious%%% So how was it? Did they figure out the noise in the car?",
  "%%%gentle and sympathetic%%% Yeah. That sounds like a lot for one day. Kettle's on.",
  "%%%proud%%% I fixed the drawer. One screw and some soap. Come open it, you have to see this.",
  "%%%exasperated and amused%%% I went in for milk. I came out with a candle and no milk.",
  "%%%earnest%%% I need to eat something in the next ten minutes or I'm going to become a problem.",
  "%%%wistful%%% Remember that fence we painted, the one that came out speckled? I still think about it.",
  "%%%patient%%% I don't think that's what she meant. Give her a day and see.",
  "%%%upbeat%%% Saturday plan: farmer's market, too many peaches, then a nap.",
  "%%%relieved%%% Oh, it's in my bag. It's been in my bag this whole time.",
  "%%%groggy but good natured%%% Morning. Half a cup in, sixty percent operational, be patient with me.",
  "%%%grateful%%% Thank you for coming to get me last week. It mattered.",
  "%%%enthusiastic%%% Okay, I finally watched it. You were right, I take it all back.",
  "%%%content%%% This is nice. The porch, the crickets, nobody needing anything for an hour.",
  "%%%rueful%%% The bread didn't rise. It's a hockey puck with ambition.",
  "%%%playful%%% Two more hours in the car. Snacks are behind you and I'm not stopping.",
  "%%%sincere%%% I was short with you this morning and it wasn't about you. I'm sorry.",
  "%%%delighted%%% Come look at the tomatoes. One of them is bigger than my fist.",
  "%%%warm and fond%%% Hey, it's me. Nothing's wrong, I just wanted to hear your voice.",
  "%%%nervous but excited%%% First day's Monday. I've changed my outfit three times already.",
  "%%%grudgingly amused%%% They closed the bridge again. On the bright side, I found a boiled peanut stand.",
  "%%%proud and animated%%% She got the ball away from the big kid twice. She wants to be a goalie now.",
  "%%%calm%%% Got a flat on the way home. Changed it myself. Only swore twice.",
  "%%%overjoyed%%% No way. You said next month. Get in here right now.",
  "%%%uncertain%%% Be honest, is it too short? I keep reaching for hair that isn't there.",
  "%%%unsettled but laughing%%% Something's in the attic. Little feet, but a lot of them.",
  "%%%mischievous%%% I've got a joke. Don't guess, you'll ruin it.",
  "%%%moved%%% Come look at the sky. The whole west side is orange and there's a purple stripe.",
  "%%%softening%%% Okay, I hear how that sounded. Your way worked fine. Hand me the brush.",
  "%%%tired but cheerful%%% Still sick. Head full of wet towels. The soup helped, though.",
  "%%%happy and overwhelmed%%% Her dad cried during the toast. Then everybody went.",
  "%%%relaxed%%% Six hours on the water, one bite, nothing caught. Best day in months.",
  "%%%welcoming%%% Come on in, door's open. Shoes wherever, the floor's seen worse.",
  "%%%matter of fact and friendly%%% Onion first, soft not brown. Then more salt than you think.",
  "%%%relieved and eager%%% I'm on the ground. Same socks since yesterday. Please have a cracker in the car.",
  "%%%skeptical%%% He looked at the roof for five minutes and gave me a number that made me laugh out loud.",
  "%%%thoughtful%%% I keep going back and forth. I think I just needed to hear myself say it.",
  "%%%energized%%% My ears are still ringing and I don't care. They played all the old stuff.",
  "%%%triumphant%%% Oh, it's a pun. It's not even a real word. Got it.",
  "%%%alert but calm%%% Power's out on our street. Candles lit, fridge stays shut, cards are out.",
  "%%%delighted%%% It's snowing. Big fat flakes, the kind that stick to your eyelashes.",
  "%%%philosophical%%% I got store credit for the blender. The circle of life.",
  "%%%tender%%% That's enough for tonight. The book will still be there tomorrow.",
  "%%%hopeful%%% She said she'd be in touch by Friday, and she said it like she meant it.",
  "%%%good natured%%% Yes, the kitchen looks like this on purpose. Trust the process.",
  "%%%amused and fond%%% The kid next door came to ask for work. He's eight. He brought his own rake.",
  "%%%peaceful%%% Took the long way home past the lake. There was a heron. I just sat there.",
  "%%%organized and cheerful%%% Eggs, the good butter, and that coffee in the red bag. Text me if you think of anything.",
  "%%%bracing%%% Cold enough to see your breath. The car took three tries.",
  "%%%worried%%% I can't find her cookie recipe. The index card with the coffee stain.",
  "%%%warm and teasing%%% You clean up pretty good. I almost didn't recognize you without the paint on your hands.",
  "%%%easygoing%%% That's the whole update. A lot of small stuff adding up to a good week.",
  "%%%conspiratorial%%% I already got your present. It's wrapped. It's in the trunk of my car.",
  "%%%interested%%% What's up? Your message just said call me, which means good news or a couch.",
  "%%%satisfied%%% Whole crossword done. I'm going to sit here and feel smart for a minute.",
  "%%%affectionate and a little stern%%% Go to the appointment. I'll call Thursday and I'm going to ask.",
  "%%%decisive%%% Tacos. I'm getting my shoes on and I'm not discussing it further.",
  // ── batch two (Part 117.2) ───────────────────────────────────────────────
  "%%%pleased and a little smug%%% Four dollars for the whole set of green bowls. Everything gets served in the bowls now.",
  "%%%relieved%%% No cavities. I've been treating flossing like a suggestion, so that's a miracle.",
  "%%%sheepish and friendly%%% About your ladder. The one from April. I have news.",
  "%%%enthusiastic%%% I learned three chords. That's half of all music, I'm told.",
  "%%%content%%% Washed the car. Found four pens, a sock, and the sunglasses I already replaced.",
  "%%%warm and nostalgic%%% Found the old pictures. You on the porch with a popsicle, six years old, like you owned the place.",
  "%%%mock brave%%% There's a spider in the bathroom. A spider with opinions.",
  "%%%cheerful%%% I'm bringing the potato salad Saturday. The real one. Don't panic.",
  "%%%baffled and amused%%% Eleven socks. I counted them going in. One is just gone.",
  "%%%tired and warm%%% Still up. Three episodes ago I said one more. I'm a happy liar with a blanket.",
  "%%%excited%%% The couch came. They had to take the door off. I'm never getting up.",
  "%%%amused and apologetic%%% I texted my cousin instead of you. She said yes. So now Thursday is real.",
  "%%%awed%%% Saw the sun come up this morning. The whole field was pink.",
  "%%%gentle and steady%%% He's tired, but he's himself. He complained about the pudding, so that's good.",
  "%%%curious and delighted%%% The old radio works. It picks up the station from the next county.",
  "%%%affectionate and worn out%%% I was a horse, a bridge, and briefly, a villain. The twins are asleep.",
  "%%%gentle and sincere%%% You don't have to be okay about it yet. I'm bringing the bad movie and the good ice cream.",
  "%%%decisive%%% Four squares of the same blue on the wall for a week. I'm picking the second one.",
  "%%%proud and worn out%%% I finished it. Every mile. My knees and I are no longer speaking.",
  "%%%delighted%%% The neighbor's dog came through the gate and lay down like he lives here. His name is Biscuit.",
  "%%%proud%%% Three layers, real frosting, and it's only leaning a little. It's a modern cake.",
  "%%%relaxed%%% Three days off and no plans. I'm protecting that with my life.",
  "%%%relieved and emotional%%% We found her. Two streets over, on somebody's porch, eating ham.",
  "%%%careful and kind%%% It's shorter than you asked for. But you can see your face now, and it's a good face.",
  "%%%matter of fact%%% The big branch came down. Missed the house, missed the car, took out the birdbath.",
  "%%%warm and curious%%% Forget the resume. What would you do with a free Saturday?",
  "%%%fond and a little emotional%%% She walked in without looking back. I was the one crying in the car.",
  "%%%exasperated and amused%%% My phone screen is cracked in the exact shape of Texas. I dropped it once.",
  "%%%friendly and open%%% Excuse me, that jacket is fantastic. Where did you find that?",
  "%%%mock indignant%%% There was never cinnamon in it. Thirty years in that kitchen. Never.",
  "%%%happy and a little unsure%%% First Monday of not going in. I organized the spice rack. Alphabetically.",
  "%%%mildly betrayed%%% A brand new bottle of soda, sealed, and flat. I drank it anyway.",
  "%%%mock outraged%%% Something is eating my strawberries. Only the ripe ones. It has taste.",
  "%%%fond%%% The truck hit two hundred thousand miles today. I pulled over to watch it happen.",
  "%%%conspiratorial and excited%%% Everybody's here at six. The cake's in the neighbor's fridge. Park down the street.",
  "%%%tired and satisfied%%% That's the last box. I can't find the forks, but I'm home.",
  "%%%warm and neighborly%%% Supper's at the hall Thursday. Bring a dish or just bring yourself.",
  "%%%casual%%% Big bag of rice or the little one? I'm getting the big one. Home in twenty.",
  "%%%amused and a little panicked%%% Tooth's under the pillow and all I've got is a twenty. Check the junk drawer.",
  "%%%amused and tolerant%%% The neighbor's learning trumpet. Same six notes every night at seven fifteen.",
  "%%%grateful%%% He was over with the chainsaw before I found my boots. Didn't even ask.",
  "%%%laughing at yourself%%% I told him the party's Wednesday. It's Saturday. He can't keep a secret.",
  // ── batch three (Part 117.6) ─────────────────────────────────────────────
  "%%%happy and a little worn out%%% We did the whole fair. A goat ate a corner of my program.",
  "%%%mildly outraged%%% Have you seen the power bill? I had to sit down.",
  "%%%resigned and amused%%% Jury duty. Third time. I think my name has a star next to it.",
  "%%%amazed%%% New glasses. I can see leaves. Individual leaves. On trees.",
  "%%%calm on purpose%%% Foot on the brake. Both hands. One lap of the parking lot.",
  "%%%pleased%%% Went to the library for one book. Came home with seven.",
  "%%%mock outraged%%% A whole bucket of water down my shirt. On a Tuesday.",
  "%%%exasperated%%% The zipper on my good jacket went, right as it got cold.",
  "%%%happy%%% We finally got the hard part of the new song. The basses came in late, but together.",
  "%%%patient and encouraging%%% Again from the top. Slower is fine. Nobody's timing you.",
  "%%%delighted%%% School's closed. Everything's closed. Pancakes are going.",
  "%%%nervous and hopeful%%% I've got the toast down to two minutes. Can I try it on you?",
  "%%%easygoing%%% Took the bus today. A man had a conversation with a pigeon for three stops.",
  "%%%delighted%%% Christmas dishes at the thrift store. The ones with the holly. Six dollars.",
  "%%%tired and satisfied%%% Forty jars of tomatoes. The whole house smells like August.",
  "%%%cheerful%%% Same parade as every year. The mayor's car stalled twice. He waved through both.",
  "%%%peaceful%%% Storm coming in, window cracked, blanket. Best nap of my life in about four minutes.",
  "%%%proud and a little amazed%%% First paycheck. Smaller than I thought. I don't even care.",
  "%%%gentle and steady%%% The service was nice. His brother told the fishing boat story and everybody laughed.",
  "%%%amused and fond%%% Everybody's grayer, same laughs, and the same two people still aren't speaking.",
  "%%%proud and a little shy%%% I floated on my back for a whole minute tonight. One of the kids clapped.",
  "%%%matter of fact%%% Gutters are done. There was a tennis ball and a whole ecosystem up there.",
  "%%%unsettled and amused%%% There's a mouse in the pantry. He left footprints across the flour.",
  "%%%relieved and moved%%% Somebody turned in my wallet. Everything in it. A lady in a green truck.",
  "%%%relieved%%% Vet says it was just a bad tooth. She's home on the good pillow.",
  "%%%cheerful%%% I signed up for cookies for the bake sale. So that's a hundred cookies.",
  "%%%proud%%% Fixed the porch swing. New chains, two boards, and it's got the good creak back.",
  "%%%proud and amused%%% He was a tree in the school play. He forgot his line and said something better.",
  "%%%resigned and amused%%% Three hours at the license office. I know about the guy next to me's divorce now.",
  "%%%tired and happy%%% We made it to the top. You can see three counties.",
  "%%%excited%%% Blanket, bug spray, the good spot by the water. Now we wait for dark.",
  "%%%determined and a little grumpy%%% Lights are going up today. The ladder's already out, so it's real.",
  "%%%rueful%%% The dishwasher died mid-cycle. I wash, you dry, like it's nineteen eighty.",
  "%%%content%%% The fire's finally going right. Pull your chair up.",
  "%%%happy%%% Dug the bike out of the shed. Rode to the end of the road like I was twelve.",
  "%%%playful%%% Deal me in. I know I lost last week. I've been practicing.",
  "%%%pleased%%% The refund came. It's going to the water heater, but I'm dreaming about a beach for one more day.",
  "%%%amused%%% The neighbors got chickens. One of them thinks the fence is a suggestion.",
  "%%%delighted%%% A hand-painted sign that just said peaches. I stopped. No regrets.",
  "%%%strained and amused%%% Lift with your legs. Why is it heavier on this end.",
  "%%%relaxed%%% We're at the lake. The dock's still standing and the loons are out.",
  "%%%matter of fact%%% First frost. Everything's done but the kale, which doesn't care about anything.",
  "%%%determined%%% Something in the fridge went bad and I'm taking out every shelf to find it.",
  "%%%content%%% Whole yard mowed before the heat. Straight lines, like a ballpark.",
  "%%%proud%%% Built a bookshelf from actual boards. It leans a little. That's character.",
  "%%%grinning%%% I sang last night. Found out at the second verse I only knew the chorus.",
  "%%%content%%% The quilt's done. Two years of Sundays. There's a square from your old blue flannel in it.",
  "%%%pleased and surprised%%% A real letter came. Same loops on the y's as when we were eleven.",
  "%%%cheerful%%% Fishing license renewed. That's the official start of the season.",
  "%%%warm and unbothered%%% Kettle's on. You're having tea before you say a word about it.",
  // ── batch four (Part 117.7) ──────────────────────────────────────────────
  "%%%warm and easy%%% You made it. I saved you the chair by the heater.",
  "%%%amused%%% The cat knocked a full glass off the counter and looked me dead in the eye.",
  "%%%pleased%%% Fixed the lamp. It was the plug. It was always the plug.",
  "%%%sympathetic%%% Okay, first thing. Have you eaten today? That's step one.",
  "%%%delighted%%% They had the good bread with the seeds. I bought two.",
  "%%%curious%%% Wait, go back. What did she say? The exact words.",
  "%%%fond%%% He fell asleep in the car holding the ice cream. Didn't spill a drop.",
  "%%%dry%%% That meeting was forty minutes. The text would have been nine words.",
  "%%%relieved%%% Found the remote. It was in the fridge. I can't explain that.",
  "%%%hopeful%%% Rain's letting up. There's a strip of blue over the barn.",
  "%%%teasing%%% You wore that shirt on purpose. Fine. It looks good.",
  "%%%content%%% Sunday morning. Coffee, the paper, and nobody needs me till noon.",
  "%%%sheepish%%% I signed us up for the chili cookoff. As a team. You cook, I'll make the sign.",
  "%%%resigned and amused%%% Check engine light's back. I put tape over it. It's quieter in here now, emotionally.",
  "%%%excited%%% The seeds came up. All of them, overnight. I said good morning to them.",
  "%%%tired%%% Long day. The kind where you stand in the kitchen with your keys still in your hand.",
  "%%%proud%%% She read the whole book by herself, then told me the ending like I hadn't read it forty times.",
  "%%%mock serious%%% Somebody keeps moving the thermostat to sixty-four. I'm looking right at the person.",
  "%%%wistful%%% The old diner closed. Terrible coffee. I'd give anything for one more cup.",
  "%%%grinning%%% Twenty years of losing at chess and tonight I got him. Rematch next year.",
  "%%%gentle%%% You don't have to talk about it. I'm just going to sit here.",
  "%%%amazed%%% The hummingbirds are back. Three of them, fighting over one feeder.",
  "%%%determined%%% I'm learning to make real bread. The first loaf will be terrible. Come by for the third.",
  "%%%delighted%%% Lightning bugs are out. First ones of the year, down by the fence.",
  "%%%amused%%% There was a sock in the pipe. The plumber didn't ask and I didn't offer.",
  "%%%pleased%%% You picked the place with the porch. Good. You can't put a swing on a weird kitchen.",
  "%%%relieved and a little shaky%%% There he is. Phone died, stopped for gas. He's fine.",
  "%%%happy%%% Garden's fenced. The rabbits watched the whole time like foremen.",
  "%%%wistful%%% The oak's got maybe five good years. That's five more summers under it.",
  "%%%fond%%% The kid across the street shoveled our walk before we were even up. Wouldn't take a dollar.",
  "%%%relieved and grossed out%%% Found the sticky spot. It was honey. Under the chair.",
  "%%%delighted%%% The new place on the corner. The thing with the eggs and the green sauce. It has my whole heart.",
  "%%%sincere%%% I heard about your dad. Whatever you're feeling is the right amount.",
  "%%%amused%%% The dog brought me the neighbor's paper this morning. We're very close.",
  "%%%happy%%% The rain finally came. Even the corn looks smug this morning.",
  "%%%amused and guilty%%% The plant you said was impossible to kill. I found a way.",
  "%%%proud%%% Ran the whole way today. The last hill just wasn't there.",
  "%%%mock exasperated%%% Somebody ate the last piece of cake and put the empty plate back in the fridge.",
  "%%%tender%%% The kids made breakfast. The eggs were interesting. I ate all of it.",
  "%%%conspiratorial%%% The candy's in the glove box. If you find it, you didn't.",
  "%%%relieved%%% Test results are all clear. Let's go get a milkshake. A large one.",
  "%%%delighted%%% We met the neighbors via their tortoise. He was under the hydrangea.",
  "%%%nostalgic%%% They're tearing down the old high school. I took a brick.",
  "%%%excited%%% The record came. Two years of hunting. Both sides, no phone.",
  "%%%calm and reassuring%%% Stove's off, door's locked, cat has food. Go. Send me the ocean.",
  "%%%fond%%% My uncle fell asleep mid-sentence again. He'll finish it next Thanksgiving.",
  "%%%determined%%% Garage this weekend. Every box that says miscellaneous gets opened. There's a dumpster coming.",
  "%%%warm%%% The old truck turned over on the second try. Still smells like his cigars.",
  "%%%curious%%% What's that song from the wedding? The one even your grandmother got up for.",
  "%%%tender%%% I made your mother's soup from the card. It's close. The kitchen smelled like her house for a minute.",
  // ── batch five (Part 118) ──────────────────────────────
  "%%%fond and a little defeated%%% The cat that isn't ours got the end of the tuna. I know what that means.",
  "%%%pleased%%% New battery in the smoke detector. The house is quiet and I feel like I won something.",
  "%%%delighted%%% First tomato of the year. It's the size of a golf ball and I'm treating it like a trophy.",
  "%%%sheepish%%% Left the dome light on all night. Again. The neighbor came over with cables before I asked.",
  "%%%content%%% I kind of like the laundromat. Nobody needs anything from me for an hour.",
  "%%%baffled%%% Ordered a coffee and a biscuit. Got four hash browns and nothing else. Four.",
  "%%%mock serious%%% Somebody set the thermostat to sixty-four last night and I woke up wearing a hat.",
  "%%%flustered and laughing%%% There is a bird in the kitchen. It's on the paper towel holder judging me.",
  "%%%proud%%% The starter is alive. Bubbles and everything. First loaf is Saturday.",
  "%%%wry%%% Got the flu shot. The pharmacist said I'd feel a little sore and I said I already did.",
  "%%%tired and amused%%% There's a cricket in the bedroom who only sings when I turn off the lamp.",
  "%%%teasing%%% Made the playlist for the drive. There's a song at the end you'll have feelings about.",
  "%%%awed and tender%%% Three deer in the backyard this morning, eating the hostas in the fog.",
  "%%%relieved%%% Found the spare key in the flowerpot. Where it always is. Where I looked twice.",
  "%%%dramatic and mournful%%% The coffee maker died. Eleven years. One sad gurgle and it gave up.",
  "%%%annoyed%%% The garage door only goes halfway now. Up, down, halfway. It's making a point.",
  "%%%delighted%%% The kids next door built a leaf pile taller than the mailbox and then jumped in it.",
  "%%%wistful%%% Lost a glove. Just the left one. The right one's in my pocket waiting.",
  "%%%rueful%%% Sunscreen on everything except the tops of my feet. I'm walking like the floor is hot.",
  "%%%amused%%% The motel sign said color television. In this decade. The bed was fine, though.",
  "%%%calm and content%%% The wind chimes got going around four. The low ones. Like a church a mile away.",
  "%%%determined%%% Sunday I'm putting hooks in the mud room. Everybody gets a hook. New era.",
  "%%%pleased%%% Chili's better on the second day. Enough for both of us if you bring cornbread.",
  "%%%fond%%% My brother sent one word to the family chat. Nice. It's my favorite message every time.",
  "%%%nostalgic%%% Got on the tire swing by the creek. It held. For four seconds I was nine.",
  "%%%warm%%% Our mail carrier brings the dog a biscuit. Not us. Him. We're just where the dog lives.",
  "%%%rueful%%% Burned the toast so bad the dog left the room. Scraped it. Family tradition.",
  "%%%tender%%% My sister's old coat fits me now. Took twenty years. There's a movie ticket in the pocket.",
  "%%%patient and amused%%% Nine people in the pharmacy line and every one of us had a five-minute question.",
  "%%%proud%%% Carved the pumpkin. One big eye, one small eye. The kids say it's scary. It looks confused.",
  "%%%unbothered%%% Got caught singing at the red light. The lady in the next car joined in on the chorus.",
  "%%%pleased%%% Two inches in the rain gauge overnight. The garden looks like it got good news.",
  "%%%fond%%% My cousin's coming Friday with the twins. I've hidden everything breakable.",
  "%%%embarrassed and amused%%% The new shoes squeak. I walked into the meeting like a duck had come in.",
  "%%%content%%% Gas station coffee at five in the morning. It's not good. It's right.",
  "%%%baffled%%% The remote turned up in the bathroom. Nobody's explaining. Nobody's asking.",
  "%%%awed%%% Everything's glass this morning. Every branch, every wire, the whole fence line shining.",
  "%%%amused%%% Somebody sat in our pew. Mama just sat in front of them and sang a little louder.",
  "%%%relieved%%% Cleaned the lint trap. Came out like a whole gray sweater. Dryer runs like new.",
  "%%%happy%%% The hoop's back up. Basketball on the driveway every evening till the streetlight.",
  "%%%wistful%%% Last peaches of the season. Eating one over the sink. Juice to my elbow. No regrets.",
  "%%%irritated%%% The storm door slams every time. The dog jumps. I jump. I'm the one who opened it.",
  "%%%fond and tired%%% Four ten-year-olds still whispering about a ghost at midnight. The ghost is the ice maker.",
  "%%%thoughtful%%% Sat in the lawn chair an hour and did nothing. Can't remember the last time on purpose.",
  "%%%warm%%% Roast's been in the crockpot since seven. The house smells like Sunday on a Tuesday. Come by.",
  "%%%calm%%% The yard light came on by itself tonight. A wasp nest was covering the little eye.",
  "%%%delighted%%% Got a wrong number and talked tomatoes for ten minutes. I have a tomato friend now.",
  "%%%apologetic%%% The card's late. I bought it three weeks ago. It says the true thing, though.",
  "%%%mock outraged%%% The squirrel hangs upside down on the feeder and eats like he owns the place.",
  "%%%mildly annoyed%%% Four phone chargers in this house and one of them was in the dog's bed.",
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
