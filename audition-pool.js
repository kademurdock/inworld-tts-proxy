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
