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
 *   • Paragraphs are 2–3 sentences. The proxy splits on the blank line and
 *     performs each paragraph as its own steered chunk with the previous
 *     paragraphs as synthesis context, which is how the feeling gets to
 *     change without the pace changing.
 *   • No slop: no "I'm here for you", no "you've got this", no "it's okay to
 *     not be okay", no "let's dive in", no em dashes, no "honestly" openers.
 *
 * Part 117.2: batch two added at her word ("add even more of them").
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
