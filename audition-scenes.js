'use strict';
const fs = require('node:fs');
const path = require('node:path');

// October 14: curated, group-aware scripts. %%% cues use the existing Drama3
// adapter (and retained Inworld adapter); fixed local text, with no generation during auditions.
// Each tuple is [audience, use, feeling, monologue, quick preview].
const SCENES = [
  ['kids','conversation','pleased',"I saved you the blue one. Everybody wanted blue, so I put it under my notebook before they came over. You can trade me if you'd rather have green.","I saved you the blue one. It's under my notebook so nobody takes it."],
  ['kids','conversation','curious',"Do you think the fish knows we're looking at it? It keeps coming over to this side. Maybe we're the show and it's waiting for us to do something.","The fish keeps looking at us. Maybe we're supposed to do a trick."],
  ['kids','conversation','disappointed and hopeful',"I practiced that bit all week and still missed it. It sounded right when I was at home. Can I try once more before we pack everything away?","I missed the bit I practiced. Can I have one more try?"],
  ['kids','conversation','excited',"Come look at this before it falls down. I used every block except the two the dog chewed. Don't step there, that's the bridge.","Come look at my tower. Wait, go around that bit. That's the bridge."],
  ['kids','conversation','sheepish',"I was going to tell you about the paint. Then you started talking about dinner and I forgot. It's mostly on the newspaper, but some of it went through.","I meant to tell you about the paint. Some of it went through the newspaper."],
  ['kids','conversation','thoughtful',"I sat with the new kid today. We didn't really talk much because the room was so noisy. Tomorrow I'm going to ask if they want to bring their lunch outside.","The new kid sat with me today. I think I'll save that seat tomorrow."],
  ['kids','conversation','amused',"My little brother thinks I can read everything now. He brought me the back of a shampoo bottle. I got as far as water, and then I told him it was bedtime.","My brother asked me to read the shampoo bottle. I knew the word water."],
  ['kids','conversation','determined',"No, don't tell me where the piece goes yet. I can see the corner of the roof on it. Turn the picture this way and let me work it out.","Don't tell me where the puzzle piece goes. I nearly have it."],
  ['kids','book','curious',"The parcel was small enough to fit in a coat pocket. Something inside it tapped three times. She tapped back, then carried it very carefully to the kitchen table.","Something inside the parcel tapped three times. She tapped back."],
  ['kids','book','hopeful',"By morning, the paper boat had reached the other side of the pond. It was caught in the reeds beside a much bigger boat. Someone had written a reply on its sail.","The paper boat came back across the pond. There was a reply on its sail."],
  ['kids','book','amused',"The dog was waiting beside the empty chair. On the chair lay a sandwich with one very neat bite missing. Nobody said anything, and the dog tried not to look pleased.","There was one bite missing from the sandwich. The dog was looking at the ceiling."],
  ['kids','book','interested',"There were six umbrellas by the door, but only five people in the house. The smallest umbrella was still dripping. Underneath it sat a frog wearing a yellow scarf.","The smallest umbrella was dripping. A frog in a yellow scarf sat underneath it."],
  ['kids','book','relieved',"They found the missing rabbit under the school steps. It had made a bed out of last week's spelling sheets. The teacher fetched a carrot, and everyone waited for it to come out.","The rabbit had made a bed from the spelling sheets. It wasn't ready to leave."],
  ['kids','book','fond',"Grandad held the bicycle while she climbed on. This time she kept looking at the end of the path. When she looked back, he was standing by the gate with both hands in the air.","She looked back at the gate. Grandad wasn't holding the bicycle anymore."],
  ['kids','book','excited',"The curtains opened before he had found his hat. He took one look at the audience and decided a wizard could manage without it. Somewhere in the front row, his sister gave him a thumbs-up.","The curtains opened and his hat was still missing. He stepped onto the stage anyway."],
  ['kids','book','content',"After the rain, they went back to check the little garden. Two green shoots had pushed through the soil beside the stick. She counted them twice, then went to find someone else to tell.","There were two green shoots beside the stick. Yesterday there hadn't been any."],
  ['characters','conversation','suspicious',"You said the cave was empty. I distinctly remember that part. So before we go any farther, tell me what you meant by empty.","You said this cave was empty. What exactly did you mean by empty?"],
  ['characters','conversation','weary and amused',"The dragon is back on the roof. I've asked it to move, and it has pretended not to hear me. Bring the bucket of apples; we may be able to negotiate.","The dragon's on the roof again. Bring the apples. We're negotiating."],
  ['characters','conversation','matter of fact',"I can mend your ship or I can finish my soup. If you want both done before nightfall, you'll need to hold this wire. Not that one, the one that isn't smoking.","Hold this wire while I mend the ship. The other one. This one's smoking."],
  ['characters','conversation','embarrassed',"The spell worked perfectly on the spoon. Nobody told me the entire drawer would be listening. We'll have to wait until the forks get tired of dancing.","The spell was meant for one spoon. Apparently the forks were listening."],
  ['characters','conversation','pleased',"I found a way past the gate. It involves a ladder, an apology, and your very convincing impression of a lost delivery driver. Which part would you like to handle?","We can get past the gate. I have a ladder and most of a plan."],
  ['characters','conversation','concerned',"That light wasn't on when we left. Leave your helmet fastened while I check the air. If I wave at you, come over; if I run, you run too.","Leave your helmet fastened. That light wasn't on when we left."],
  ['characters','conversation','indignant',"I did not lose the treasure map. I know exactly where it is. The difficulty is persuading that very large bird to give it back.","I know where the map is. We just need the bird to let go of it."],
  ['characters','conversation','reassuring',"You don't have to make the whole crossing tonight. There's a sheltered place just beyond those trees. We'll get a fire going and deal with the river in the morning.","There's shelter beyond those trees. We can deal with the river tomorrow."],
  ['characters','book','intrigued',"The clockmaker turned the key once more. Every clock in the shop stopped except the little brass one in her hand. Its hands were moving backward, and someone was knocking at yesterday's door.","Every clock stopped except the brass one. Its hands were moving backward."],
  ['characters','book','serious',"The captain waited until the last light had disappeared from shore. Then she unfolded the letter and read the address again. They had been sailing toward the wrong island for three days.","The captain read the address again. They were sailing toward the wrong island."],
  ['characters','book','amused',"The royal messenger arrived covered in flour. His horse had eaten the invitation, and the baker had refused to write another. He bowed to the queen and began with the parts he could remember.","The messenger bowed to the queen. His horse had eaten the invitation."],
  ['characters','book','curious',"The machine woke when the room went dark. It checked the empty chair, then the cup beside it. For the first time, it left the light on after the cleaning was done.","The machine checked the empty chair. This time it left the light on."],
  ['characters','book','uneasy',"There were fresh footprints on the stairs. They started at the locked door and ended halfway down. He put the lantern on the floor and listened to the silence above him.","The footprints ended halfway down the stairs. He set the lantern down and listened."],
  ['characters','book','delighted',"The giant knelt beside the broken cart. With one finger he lifted the wheel back into place. The farmer offered him an apple, which he accepted as carefully as if it were made of glass.","The giant accepted the apple carefully. It looked very small in his hand."],
  ['characters','book','determined',"The storm had carried the signal flag into the sea. She climbed onto the roof with her red coat instead. Far beyond the rocks, the rescue boat changed direction.","She raised her red coat above the roof. Out at sea, the boat turned toward her."],
  ['characters','book','wistful',"The innkeeper kept the smallest room ready all winter. Each evening he set a fresh candle by the window. When the traveler finally returned, he asked whether she would like the usual breakfast.","He kept her room ready all winter. When she returned, he asked about breakfast."],
  ['adults','conversation','interested',"Wait, start again from when you got there. You said the door was open, but nobody was answering? I was putting the shopping away and missed the important bit.","Start again from when you got there. I missed the bit about the open door."],
  ['adults','conversation','apologetic',"I thought I'd sent that message yesterday. I just found it sitting there with half a sentence missing. Are you still free on Friday, or have I left it too late?","I never sent yesterday's message. Are you still free on Friday?"],
  ['adults','conversation','pleased',"Leave the bags there for a minute. I've got the kettle on, and there's a seat by the window if you want it. You can tell me about the trip once you've taken your coat off.","Leave the bags there. I've put the kettle on, and that seat's yours."],
  ['adults','conversation','uncertain',"I'm not sure I want the bigger place. The extra room would be useful, but I'd miss being able to walk everywhere. Can we go back and look at the smaller one again?","The bigger place has another room. I'd miss walking everywhere, though."],
  ['adults','conversation','amused',"I went back for the thing I forgot and came out with something else. The thing I forgot is still there. At this point I'm just going to write it on my hand.","I went back for the thing I forgot. Came out without it again."],
  ['adults','conversation','concerned',"You haven't touched your food. We can put it in the fridge if you're not hungry. Do you want to talk about what happened, or should I tell you about my ridiculous afternoon?","We can save your dinner. Want to talk, or hear about my afternoon?"],
  ['adults','conversation','relieved',"They called back this morning. I don't have to start over; they just need the page I forgot to sign. I've put it right by the door so I can't possibly leave without it.","They only need the page I forgot to sign. I don't have to start over."],
  ['adults','conversation','fond',"I found the photo from that rainy weekend. You're holding the umbrella over the dog, and the rest of us are getting soaked. I sent it to my brother, and he remembered the terrible sandwiches.","I found that rainy weekend photo. The dog was the only one under the umbrella."],
  ['adults','book','thoughtful',"The kitchen looked smaller with the table gone. She stood where her father used to sit and watched the evening light reach the wall. On the windowsill, somebody had left the key to the shed.","With the table gone, she could see where the evening light reached the wall."],
  ['adults','book','curious',"The envelope had no return address. Inside was a photograph of the house before the extra room was built. He turned it over and found his own name in handwriting he recognized.","He turned the photograph over. His name was written in a hand he recognized."],
  ['adults','book','content',"By six, the street market was packing away. She bought the last bunch of flowers and carried them home against her coat. Upstairs, the radio was playing through an open window.","She bought the last bunch of flowers as the market packed away."],
  ['adults','book','uneasy',"He checked the platform number for the third time. The train was due in four minutes, and the seat beside him was still empty. When his phone finally rang, he almost let it fall.","Four minutes until the train. The seat beside him was still empty."],
  ['adults','book','warm',"Her neighbor knocked just as she was taking the bread out. He said he'd come to return a bowl. By the time she found somewhere to put it, they were already talking about next Sunday's dinner.","He'd only come to return a bowl. She put another plate on the table."],
  ['adults','book','determined',"The first attempt had left a dark mark across the wood. He sanded it back and measured the distance again. This time he put the drawing where he could see it before picking up the saw.","He sanded the mark out and measured again. This time the drawing stayed in view."],
  ['adults','book','wistful',"At the traffic light, she recognized the tune from the car beside her. She had not heard it since the summer they painted the flat. The light changed before she could remember the singer's name.","A familiar song came from the next car. She couldn't remember the singer's name."],
  ['adults','book','hopeful',"He put two cups on the counter, then moved one back into the cupboard. A moment later, there was a knock. He took the cup out again and went to answer the door.","He put the second cup away. Then someone knocked at the door."],
];

// Each original scene has a full reading and a short excerpt for the wheel.
// Fixed local files keep previews predictable and require no generation call.
for (const audience of ['kids', 'characters', 'adults']) {
  for (const kind of ['conversation', 'book']) {
    const file = `${audience}-${kind}.txt`;
    const lines = fs.readFileSync(path.join(__dirname, 'audition-library', file), 'utf8').trim().split(/\r?\n/);
    if (lines.length !== 492) throw new Error(`Incomplete audition library: ${file}`);
    for (const line of lines) {
      const [feeling, monologue, extra] = line.split('|');
      if (extra !== undefined || !/^[a-z ]+$/.test(feeling) || !monologue) {
        throw new Error(`Invalid audition scene in ${file}`);
      }
      const sentences = monologue.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()) || [];
      const limit = 160 - `%%%${feeling}%%% `.length;
      if (sentences.length < 3 || monologue.length >= 440 || sentences[0].length > limit) {
        throw new Error(`Invalid audition length in ${file}`);
      }
      let quick = sentences[0];
      if (`${quick} ${sentences[1]}`.length <= limit) quick += ` ${sentences[1]}`;
      SCENES.push([audience, kind, feeling, monologue, quick]);
    }
  }
}

const POOLS = Object.fromEntries(['kids','characters','adults'].map(audience => [audience, {
  long: SCENES.filter(s => s[0] === audience).map(s => `%%%${s[2]}%%% ${s[3]}`),
  quick: SCENES.filter(s => s[0] === audience).map(s => `%%%${s[2]}%%% ${s[4]}`),
}]));

// Oct 16 2026, Kade: auditions should sound like a character's voice message, "when reading
// books, they shouldn't". Every script string knows whether it is a conversation or a book scene.
const KIND_BY_SCRIPT = new Map(SCENES.flatMap(s => [[`%%%${s[2]}%%% ${s[3]}`, s[1]], [`%%%${s[2]}%%% ${s[4]}`, s[1]]]));

function audienceFor(categories) {
  const groups = (Array.isArray(categories) ? categories : []).map(c => String(c).split(',')[0].trim());
  if (groups.includes('Kids and teens')) return 'kids';
  if (groups.includes('Characters')) return 'characters';
  if (groups.includes('Women') || groups.includes('Men')) return 'adults';
  return 'kids'; // Unknown metadata gets family-safe scenes, never the adult pool.
}

function createScenePicker() {
  // Six process-local bags, shared across voices. Browsing a different voice
  // cannot reset the category's rotation; a service restart starts fresh bags.
  const rotations = new Map();
  return function pickScene(row, quick = false, random = Math.random) {
    const audience = audienceFor(row?.categories);
    const length = quick ? 'quick' : 'long';
    const pool = POOLS[audience][length];
    const key = `${audience}:${length}`;
    const state = rotations.get(key) || { remaining: [], previous: undefined };
    if (!state.remaining.length) {
      state.remaining = pool.map((_, index) => index);
      for (let i = state.remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [state.remaining[i], state.remaining[j]] = [state.remaining[j], state.remaining[i]];
      }
      const end = state.remaining.length - 1;
      if (state.remaining[end] === state.previous) {
        [state.remaining[0], state.remaining[end]] = [state.remaining[end], state.remaining[0]];
      }
    }
    const index = state.remaining.pop();
    state.previous = index;
    rotations.set(key, state);
    return pool[index];
  };
}

const pickScene = createScenePicker();
module.exports = { SCENES, POOLS, KIND_BY_SCRIPT, audienceFor, pickScene, createScenePicker };
