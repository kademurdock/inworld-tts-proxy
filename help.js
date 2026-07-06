// ---- Kade-AI Help System ----
// A small hub of short, screen-reader-first help pages, served from the
// inworld-tts-proxy Railway service (same pattern as the /voices page).
//
// Design notes for whoever touches this next:
//  - Every page is fully static authored HTML. Nothing user-supplied is ever
//    interpolated into the markup, so plain template literals are safe here
//    (no injection surface). The one bit of client JS (hub search) only reads
//    from a server-authored array.
//  - Accessibility is the whole point. Match the /voices page: semantic
//    landmarks (<header><nav><main><footer>), one <h1> then <h2>/<h3>, a
//    "skip to main content" link, a keyboard-reachable section nav on every
//    page with aria-current on the active link, visible focus outlines, big
//    tap targets, dark theme, and a "Back to Kade-AI chat" link up top.
//  - Public "house voice" only. Warm, funny, plain. NOT Kiana's persona.
//  - Contact line is always the literal words "contact Kade" (no email/phone).
//
// Mounted in server.js via:  app.use(require("./help"));

const express = require("express");
const router = express.Router();

const CHAT_URL = "https://kademurdock.com";
const PAYPAL_URL = "https://paypal.me/kademurdock";

// ---- Navigation model ----
// One source of truth for every section + which group it belongs to. The nav
// is rendered from this on every page, so links stay consistent and we can
// verify offline that every route resolves.
const SECTIONS = [
  { key: "home",            path: "/help",                 label: "Help Home",          group: "Getting started" },
  { key: "starthere",       path: "/help/start-here",      label: "Start Here (New to AI?)", group: "Getting started" },
  { key: "quickstart",      path: "/help/quickstart",      label: "Your First Five Minutes", group: "Getting started" },
  { key: "faq",             path: "/help/faq",             label: "Questions & Answers", group: "Getting started" },

  { key: "voice",           path: "/help/voice",           label: "Talking & Listening", group: "Using Kade-AI" },
  { key: "phone",           path: "/help/phone",           label: "Phone Calls", group: "Using Kade-AI" },
  { key: "characters",      path: "/help/characters",      label: "Characters & the Marketplace", group: "Using Kade-AI" },
  { key: "rooms",           path: "/help/debate-room",     label: "The Debate Room",     group: "Using Kade-AI" },
  { key: "games",           path: "/help/games",           label: "The Game Parlor",     group: "Using Kade-AI" },
  { key: "build",           path: "/help/build",           label: "Build Your Own Character", group: "Using Kade-AI" },
  { key: "memory",          path: "/help/memory",          label: "What It Remembers",   group: "Using Kade-AI" },
  { key: "images",          path: "/help/images",          label: "Making Pictures",     group: "Using Kade-AI" },
  { key: "audio",           path: "/help/audio",           label: "Making Audio & Voices", group: "Using Kade-AI" },
  { key: "temporary",       path: "/help/temporary",       label: "Starting Over & Private Chats", group: "Using Kade-AI" },
  { key: "cheatsheet",      path: "/help/cheatsheet",      label: "The Cheat Sheet",     group: "Using Kade-AI" },

  { key: "tokens",          path: "/help/tokens",          label: "What Are Tokens?",    group: "The money part" },
  { key: "costs",           path: "/help/costs",           label: "What This Costs Kade", group: "The money part" },
  { key: "donate",          path: "/help/donate",          label: "Feed the Server",     group: "The money part" },

  { key: "accessibility",   path: "/help/accessibility",   label: "Accessibility Tips",  group: "Getting the best experience" },
  { key: "troubleshooting", path: "/help/troubleshooting", label: "When Something Breaks", group: "Getting the best experience" },
];

const GROUP_ORDER = ["Getting started", "Using Kade-AI", "The money part", "Getting the best experience"];

function navHtml(currentKey) {
  let out = '<nav aria-label="Help sections" class="sectionnav">';
  for (const group of GROUP_ORDER) {
    out += `<h2 class="navgroup">${group}</h2><ul>`;
    for (const s of SECTIONS.filter((x) => x.group === group)) {
      const current = s.key === currentKey ? ' aria-current="page"' : "";
      out += `<li><a href="${s.path}"${current}>${s.label}</a></li>`;
    }
    out += "</ul>";
  }
  out += "</nav>";
  return out;
}

// ---- Shared page shell ----
const STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background:#0f1115; color:#eceef2; line-height:1.6; font-size:1.05rem; }
  .skip { position:absolute; left:-9999px; top:0; background:#1d2740; color:#eceef2;
          padding:12px 16px; border-radius:0 0 10px 0; z-index:50; font-weight:700; }
  .skip:focus { left:0; outline:3px solid #6ea8fe; }
  a { color:#8fc0ff; }
  a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
        outline:3px solid #6ea8fe; outline-offset:2px; border-radius:4px; }
  .wrap { max-width:1100px; margin:0 auto; }
  header.site { padding:20px 16px 14px; border-bottom:1px solid #262a33; }
  a.back { display:inline-block; color:#8fc0ff; text-decoration:none; font-weight:700;
           margin:0 0 12px; font-size:1rem; padding:6px 0; }
  a.back:hover { text-decoration:underline; }
  h1 { margin:0 0 8px; font-size:1.7rem; line-height:1.25; }
  p.tagline { margin:0; color:#aab2c0; max-width:65ch; }
  .layout { display:flex; gap:8px; align-items:flex-start; }
  nav.sectionnav { flex:0 0 270px; padding:18px 14px 30px; border-right:1px solid #262a33; }
  nav.sectionnav .navgroup { font-size:0.8rem; text-transform:uppercase; letter-spacing:0.06em;
           color:#8a93a3; margin:18px 0 6px; font-weight:700; }
  nav.sectionnav ul { list-style:none; margin:0; padding:0; }
  nav.sectionnav li { margin:0; }
  nav.sectionnav a { display:block; padding:11px 12px; border-radius:10px; text-decoration:none;
           color:#dfe4ec; font-weight:500; }
  nav.sectionnav a:hover { background:#1a1e26; }
  nav.sectionnav a[aria-current=page] { background:#1d2740; color:#fff; font-weight:700;
           border-left:4px solid #6ea8fe; padding-left:8px; }
  main { flex:1 1 auto; padding:22px 18px 60px; min-width:0; max-width:75ch; }
  main h2 { font-size:1.3rem; margin:30px 0 8px; padding-top:6px; }
  main h3 { font-size:1.08rem; margin:22px 0 6px; color:#dfe4ec; }
  main p, main li { max-width:70ch; }
  main ul, main ol { padding-left:1.3em; }
  main li { margin:8px 0; }
  .lead { font-size:1.15rem; color:#e7ebf2; }
  .term { background:#141821; border:1px solid #2a3550; border-left:4px solid #6ea8fe;
          border-radius:10px; padding:12px 16px; margin:14px 0; }
  .term strong { color:#fff; }
  .callout { background:#141821; border:1px solid #2a3550; border-radius:10px;
          padding:14px 16px; margin:18px 0; }
  .callout.warn { border-left:4px solid #e8c46a; }
  .callout.good { border-left:4px solid #6ea8fe; }
  table { width:100%; border-collapse:collapse; margin:16px 0; }
  caption { text-align:left; color:#aab2c0; margin-bottom:8px; font-size:0.95rem; }
  th, td { text-align:left; padding:12px 12px; border-bottom:1px solid #2a3037; vertical-align:top; }
  th { color:#fff; background:#141821; }
  .btnrow { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; }
  a.cta { display:inline-block; background:#1d2740; border:1px solid #3a4150; color:#fff;
          padding:13px 18px; border-radius:12px; text-decoration:none; font-weight:700; }
  a.cta:hover { background:#243152; }
  a.cta.big { font-size:1.1rem; padding:16px 22px; }
  .cards { list-style:none; padding:0; margin:18px 0; display:grid;
          grid-template-columns:repeat(auto-fill, minmax(240px,1fr)); gap:12px; }
  .cards li { margin:0; }
  .cards a { display:block; height:100%; padding:16px; border:1px solid #3a4150; border-radius:12px;
          background:#1a1e26; text-decoration:none; color:#eceef2; }
  .cards a:hover { background:#222732; border-color:#6ea8fe; }
  .cards .ttl { font-weight:700; font-size:1.05rem; color:#fff; display:block; margin-bottom:4px; }
  .cards .desc { color:#aab2c0; font-size:0.95rem; }
  .hubsearch { margin:18px 0 6px; }
  .hubsearch label { font-weight:700; display:block; margin-bottom:6px; }
  .hubsearch input { width:100%; max-width:480px; padding:13px 15px; font-size:1.05rem;
          border-radius:10px; border:1px solid #3a4150; background:#1a1e26; color:#eceef2; }
  #searchcount { color:#aab2c0; font-size:0.95rem; margin:8px 0 0; min-height:1.3em; }
  footer.site { padding:22px 18px 40px; border-top:1px solid #262a33; color:#8a93a3;
          font-size:0.95rem; }
  footer.site a { color:#8fc0ff; }
  .nextprev { display:flex; flex-wrap:wrap; gap:10px; margin:34px 0 0; padding-top:18px;
          border-top:1px solid #262a33; }

  /* ---- Decorative visual flair (all aria-hidden, never read aloud) ---- */
  header.site { position:relative; overflow:hidden;
          background:
            radial-gradient(900px 240px at 12% -40%, rgba(110,168,254,0.20), transparent 70%),
            radial-gradient(700px 220px at 95% -60%, rgba(155,120,255,0.16), transparent 70%); }
  h1 { background:linear-gradient(90deg,#cfe0ff,#a9b9ff 55%,#d8c4ff);
          -webkit-background-clip:text; background-clip:text; color:#eceef2; }
  @supports ((-webkit-background-clip:text) or (background-clip:text)) {
    h1 { -webkit-text-fill-color:transparent; }
  }
  .cards a { position:relative; transition:transform .12s ease, border-color .12s ease, background .12s ease; }
  .cards a:hover { transform:translateY(-2px); }
  .cards .ico { font-size:1.7rem; line-height:1; display:block; margin-bottom:8px; }
  .cards a::after { content:""; position:absolute; left:0; right:0; bottom:0; height:3px;
          border-radius:0 0 12px 12px;
          background:linear-gradient(90deg,#6ea8fe,#9b78ff); opacity:0; transition:opacity .12s ease; }
  .cards a:hover::after, .cards a:focus-visible::after { opacity:1; }
  a.cta { background:linear-gradient(180deg,#243152,#1b2440); transition:transform .12s ease, background .12s ease; }
  a.cta:hover { transform:translateY(-1px); }
  a.cta.big { background:linear-gradient(90deg,#2b3a63,#3a2b63); }
  .term { background:linear-gradient(180deg,#161b25,#12151c); }
  .hero-art { margin:6px 0 2px; }
  .hero-art svg { display:block; width:100%; max-width:520px; height:auto; }
  .float { animation:floaty 5s ease-in-out infinite; transform-origin:center; }
  @keyframes floaty { 0%,100%{ transform:translateY(0);} 50%{ transform:translateY(-6px);} }
  @media (prefers-reduced-motion: reduce) { .float { animation:none; } .cards a, a.cta { transition:none; } }
  @media (max-width: 820px) {
    .layout { display:block; }
    nav.sectionnav { flex:none; width:auto; border-right:none; border-bottom:1px solid #262a33; }
    main { max-width:none; }
  }
`;

function page({ key, title, h1, tagline, main }) {
  const fullTitle = title ? `${title} — Kade-AI Help` : "Kade-AI Help";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<div class="wrap">
  <header class="site">
    <a class="back" href="${CHAT_URL}">← Back to Kade-AI chat</a>
    <h1>${h1}</h1>
    ${tagline ? `<p class="tagline">${tagline}</p>` : ""}
  </header>
  <div class="layout">
    ${navHtml(key)}
    <main id="main" tabindex="-1">
${main}
    </main>
  </div>
  <footer class="site">
    <p>This is the help center for Kade-AI, a private little AI chat that Kade built and runs herself. Stuck on something not covered here? Just <strong>contact Kade</strong>.</p>
    <p><a href="${CHAT_URL}">← Back to the chat</a> &nbsp;·&nbsp; <a href="/help">Help Home</a></p>
  </footer>
</div>
</body>
</html>`;
}

// "Next / previous" footer link helper for the linear reading path.
function nextprev(prevKey, nextKey) {
  const find = (k) => SECTIONS.find((s) => s.key === k);
  let out = '<nav class="nextprev" aria-label="More help pages">';
  if (prevKey) { const p = find(prevKey); out += `<a class="cta" href="${p.path}">← ${p.label}</a>`; }
  if (nextKey) { const n = find(nextKey); out += `<a class="cta" href="${n.path}">${n.label} →</a>`; }
  out += "</nav>";
  return out;
}

// ============================================================================
//  PAGE CONTENT
//  Each entry is the inner <main> HTML for one route. Public house voice.
//  Facts (balance cap, registration, image credits, known issues, privacy)
//  trace back to PROJECT_STATUS.md.
// ============================================================================

const PAGES = {};

// ---- 1. HUB / HOME --------------------------------------------------------
PAGES.home = {
  title: "",
  h1: "Welcome to Kade-AI Help",
  tagline: "Everything you need to feel at home here — in plain language, built to work beautifully with a screen reader.",
  main: `
<p class="lead">Kade-AI is a friendly little AI chat that Kade built and runs herself, and opened up for family and friends. You type, an AI character types back (and can talk out loud if you want). That's the whole idea.</p>
<p>Brand new to AI in general? <a href="/help/start-here">Start Here</a> assumes nothing at all. Already comfortable? Jump to <a href="/help/quickstart">Your First Five Minutes</a>. Got a quick question, like "does this cost me anything?" — jump to <a href="/help/faq">Questions &amp; Answers</a>. Everything else is in the menu, and you can search it right below.</p>

<div class="hubsearch">
  <label for="hubsearch">Search the help pages</label>
  <input type="search" id="hubsearch" autocomplete="off" placeholder="Try: voice, cost, password, picture" aria-describedby="searchcount">
  <p id="searchcount" role="status" aria-live="polite"></p>
</div>

<h2>Pick a topic</h2>
<ul class="cards" id="hubcards">
  <li data-terms="start here new ai beginner never used what is this chatgpt robot confused lost"><a href="/help/start-here"><span class="ico" aria-hidden="true">🌱</span><span class="ttl">Start Here (New to AI?)</span><span class="desc">Never used AI before? This page assumes nothing. Read this one first.</span></a></li>
  <li data-terms="start basics first five minutes new beginner how"><a href="/help/quickstart"><span class="ico" aria-hidden="true">🚀</span><span class="ttl">Your First Five Minutes</span><span class="desc">The absolute basics, in order. Start here.</span></a></li>
  <li data-terms="faq questions answers chatgpt private cost cost break"><a href="/help/faq"><span class="ico" aria-hidden="true">💬</span><span class="ttl">Questions &amp; Answers</span><span class="desc">Is this ChatGPT? Is it private? Does it cost me? Quick honest answers.</span></a></li>
  <li data-terms="voice talk listen speak microphone audio speech hear sound"><a href="/help/voice"><span class="ico" aria-hidden="true">🎧</span><span class="ttl">Talking &amp; Listening</span><span class="desc">Speak instead of type, and have replies read out loud.</span></a></li>
  <li data-terms="phone call telephone dial 833 briefing news morning outbound ring think hard deep think reasoning"><a href="/help/phone"><span class="ico" aria-hidden="true">📞</span><span class="ttl">Phone Calls</span><span class="desc">Call your characters on a real phone line — and they can make calls for you.</span></a></li>
  <li data-terms="characters marketplace agents personas switch browse matchmaker match quiz find your people companions companion friend lonely company earl opal dottie marcus wanda priya"><a href="/help/characters"><span class="ico" aria-hidden="true">🎭</span><span class="ttl">Characters &amp; the Marketplace</span><span class="desc">Kiana is your host, but there's a whole cast to meet.</span></a></li>
  <li data-terms="debate room roleplay group multiple characters argue radio play conversation hall share"><a href="/help/debate-room"><span class="ico" aria-hidden="true">🎙️</span><span class="ttl">The Debate Room</span><span class="desc">Put a few characters in one room, give them a topic, and jump in.</span></a></li>
  <li data-terms="games game parlor cards blackjack wild eights go fish uno war dealer play deal poker dice trivia casino pig phone sounds quiz leaderboard game room standings wins champion cards against reality humanity wild blanks party judge crab apples apples madlibs fill-in stories guess the sound battleship farkle liars dice hangman scramble tic tac toe rock paper scissors in between acey deucey"><a href="/help/games"><span class="ico" aria-hidden="true">🃏</span><span class="ttl">The Game Parlor</span><span class="desc">Nineteen real games by voice — Blackjack, Uno, War, Cards Against Reality (you know the game), Crab Apples, Battleship, Farkle, Liar's Dice, Trivia, Hangman and more. Real table sounds, family leaderboard.</span></a></li>
  <li data-terms="build make own character agent create custom"><a href="/help/build"><span class="ico" aria-hidden="true">🛠️</span><span class="ttl">Build Your Own Character</span><span class="desc">No coding. Give it a name and a personality, and go.</span></a></li>
  <li data-terms="memory remember forget notes saves recall"><a href="/help/memory"><span class="ico" aria-hidden="true">🧠</span><span class="ttl">What It Remembers</span><span class="desc">What sticks between chats, and what doesn't.</span></a></li>
  <li data-terms="images pictures draw art generate flux make picture"><a href="/help/images"><span class="ico" aria-hidden="true">🎨</span><span class="ttl">Making Pictures</span><span class="desc">Ask for an image and it'll draw one. There's a limit, though.</span></a></li>
  <li data-terms="audio sound cadence voice clone voices radio drama podcast narration text to speech tts music sound effects sfx seed audio make audio generate audio scene dialogue movie trailer"><a href="/help/audio"><span class="ico" aria-hidden="true">🎬</span><span class="ttl">Making Audio &amp; Voices</span><span class="desc">Turn a few sentences into a full audio scene — voices, effects, and music. Meet Cadence.</span></a></li>
  <li data-terms="temporary private starting over new chat fresh delete"><a href="/help/temporary"><span class="ico" aria-hidden="true">🧹</span><span class="ttl">Starting Over &amp; Private Chats</span><span class="desc">Fresh start, or a chat that doesn't get saved.</span></a></li>
  <li data-terms="cheat sheet buttons quick reference where shortcuts deep think brain reasoning slow careful"><a href="/help/cheatsheet"><span class="ico" aria-hidden="true">📋</span><span class="ttl">The Cheat Sheet</span><span class="desc">Where the buttons are and how to do the common stuff. One page.</span></a></li>
  <li data-terms="tokens context counter words cost meaning"><a href="/help/tokens"><span class="ico" aria-hidden="true">🔢</span><span class="ttl">What Are Tokens?</span><span class="desc">That little counter, explained without the math homework.</span></a></li>
  <li data-terms="cost money bill credits balance economics pay"><a href="/help/costs"><span class="ico" aria-hidden="true">💸</span><span class="ttl">What This Costs Kade</span><span class="desc">The honest money side. Spoiler: a real person pays a real bill.</span></a></li>
  <li data-terms="donate paypal feed server support tip groceries help pay"><a href="/help/donate"><span class="ico" aria-hidden="true">🍕</span><span class="ttl">Feed the Server</span><span class="desc">The fridge doesn't refill itself. Chip in if you can. (No pressure.)</span></a></li>
  <li data-terms="accessibility screen reader voiceover nvda blind shortcuts"><a href="/help/accessibility"><span class="ico" aria-hidden="true">♿</span><span class="ttl">Accessibility Tips</span><span class="desc">Get the smoothest ride with VoiceOver or NVDA.</span></a></li>
  <li data-terms="troubleshooting broken stuck fix audio microphone problem help report bug feedback feature request suggestion tell kade"><a href="/help/troubleshooting"><span class="ico" aria-hidden="true">🔧</span><span class="ttl">When Something Breaks</span><span class="desc">The usual hiccups and how to get unstuck.</span></a></li>
</ul>

<script>
  (function(){
    var input = document.getElementById("hubsearch");
    var count = document.getElementById("searchcount");
    var cards = Array.prototype.slice.call(document.querySelectorAll("#hubcards > li"));
    function run(){
      var q = (input.value || "").trim().toLowerCase();
      var shown = 0;
      cards.forEach(function(li){
        var hay = (li.getAttribute("data-terms") + " " + li.textContent).toLowerCase();
        var match = !q || hay.indexOf(q) !== -1;
        li.style.display = match ? "" : "none";
        if (match) shown++;
      });
      count.textContent = q ? (shown + (shown === 1 ? " topic matches" : " topics match") + " your search.") : "";
    }
    input.addEventListener("input", run);
  })();
</script>
`,
};

// ---- 1b. START HERE (never used AI) ----------------------------------------
PAGES.starthere = {
  title: "Start Here (New to AI?)",
  h1: "Start Here",
  tagline: "Never used AI before? Perfect. This page assumes absolutely nothing.",
  main: `
<p class="lead">Kade-AI is a website where you have conversations. You type something, and a character types back — out loud too, if you want. That's really it. Everything else on this site is just extra toppings.</p>

<h2>So what am I actually talking to?</h2>
<p>You're talking to an <strong>AI character</strong>. The AI part means it's a computer program that has read an enormous amount of writing and learned to hold a conversation. The character part means it has a name and a personality — the host here is <strong>Kiana</strong>, and she's who greets you when you sign in.</p>
<p>Three honest things to know:</p>
<ul>
  <li><strong>It's not a person.</strong> Nobody is sitting there typing back at you. It's a program with a lot of charm.</li>
  <li><strong>It can be wrong.</strong> It usually isn't, but it can sound completely confident and still be mistaken. For anything important — medical, legal, money — double-check before acting.</li>
  <li><strong>It's patient forever.</strong> You cannot annoy it, ask a dumb question, or use it "wrong." Ask it to explain something five times, five different ways. That's what it's for.</li>
</ul>

<h2>How do I start?</h2>
<p>Type in the message box at the bottom of the chat and press enter (or the send button). Talk like you'd talk to a person: "I'm trying to write a birthday card for my sister and I'm stuck" works better than robot-speak. Whole sentences, normal words, no magic commands.</p>
<p>Don't know what to say? Steal one of these: "What can you actually do?" &middot; "Help me plan supper with what's in my fridge" &middot; "Explain how car insurance works like I'm twelve" &middot; "Tell me something interesting."</p>

<h2>You can talk instead of type</h2>
<p>There's a microphone button to speak your message, and replies can be read out loud in a real voice. There's even a phone number you can call and just talk, no computer needed. See <a href="/help/voice">Talking &amp; Listening</a> and <a href="/help/phone">Phone Calls</a>.</p>

<h2>Does this cost me money?</h2>
<p>No. Kade pays the bill so friends and family can use it. If you're curious what your chats cost her (it's usually pocket change) or want to chip in, that's <a href="/help/donate">Feed the Server</a> — zero pressure, ever.</p>

<h2>Once you're comfortable</h2>
<ul>
  <li><a href="/help/characters">Meet the other characters</a> — there's a whole cast: cooks, mechanics, grandmas, a dog.</li>
  <li><a href="/help/images">Ask for a picture</a> and it'll draw one.</li>
  <li><a href="/help/debate-room">The Debate Room</a> — put a few characters in one room and watch them argue about pineapple pizza.</li>
  <li><a href="/help/build">Build your own character</a> — no coding, just a name and a personality.</li>
</ul>

<h2>You can't break anything</h2>
<p>Worst case, a conversation gets weird or boring — so you <a href="/help/temporary">start a new chat</a> and it's a clean slate. And if you're ever lost, ask the character itself: "how does this site work?" It knows. Or come back here and use the search on the <a href="/help">help home page</a>.</p>
`,
};

// ---- 2. QUICK START -------------------------------------------------------
PAGES.quickstart = {
  title: "Your First Five Minutes",
  h1: "Your First Five Minutes",
  tagline: "Brand new? Do these in order. You'll be chatting like a pro before your coffee gets cold.",
  main: `
<p class="lead">There's nothing to set up. You land on the chat and you're ready. Here's the whole thing, step by step.</p>

<h2>1. Say hi to Kiana</h2>
<p>When you log in, you're already talking to <strong>Kiana</strong> — she's the friendly host of the place. You don't have to pick anything. She's just there, ready.</p>

<h2>2. Type like you're texting a friend</h2>
<p>Find the message box at the bottom of the screen and type whatever's on your mind. "What's a good dinner with chicken and rice?" "Explain my new phone bill." "Tell me a joke." There's no wrong way to ask. Plain words work great.</p>

<h2>3. Send it</h2>
<p>Press <strong>Enter</strong> (or tap the send button next to the box) to send your message. Kiana will think for a second, then reply right below.</p>

<h2>4. Want to hear her talk?</h2>
<p>You can have replies read out loud instead of reading them yourself. There's a play button on each reply, and you can turn on automatic read-aloud so it just happens. The full how-to is on the <a href="/help/voice">Talking &amp; Listening</a> page.</p>

<h2>5. Don't love the voice? Change it</h2>
<p>Most characters now come with their own voice already picked out. Want something different? Open <strong>Settings → Speech → Text-to-Speech → Voice</strong>, pick from over two hundred voices, and tap <strong>Preview</strong> to hear a sample before you commit.</p>

<h2>6. Want a clean slate?</h2>
<p>To start a brand-new conversation, look for the <strong>New chat</strong> button (usually top of the screen or in the side menu). Your old chats are saved in the list on the side, so you can always go back to one.</p>

<h2>7. Meet the rest of the cast</h2>
<p>Kiana's not the only one here. There's a whole <strong>marketplace</strong> of characters — a mechanic, a chef, a bedtime-story reader, you name it. See <a href="/help/characters">Characters &amp; the Marketplace</a> to go exploring.</p>

<h2>8. Prefer an actual phone call?</h2>
<p>You can literally call the place: dial <strong>1-833-530-0313</strong> and talk to a character out loud, like a normal phone call. There's also a phone button right in the chat for a hands-free voice conversation. Details on the <a href="/help/phone">Phone Calls</a> page.</p>

<div class="callout good">
  <p><strong>That's it.</strong> Honestly, that's the whole learning curve. Everything else on this site is a bonus you can pick up whenever you feel like it.</p>
</div>
${nextprev(null, "faq")}
`,
};

// ---- 3. FAQ ---------------------------------------------------------------
PAGES.faq = {
  title: "Questions & Answers",
  h1: "Questions & Answers",
  tagline: "The real questions people ask in their first week. Short, honest answers.",
  main: `
<h2>Is this ChatGPT?</h2>
<p>No. This is Kade's own private setup that she built and runs herself. Under the hood it uses powerful AI models to do the thinking, but it isn't ChatGPT, and your stuff here isn't tied to any big company's account. Think of it as a cozy independent place rather than a chain restaurant.</p>

<h2>Does it cost me anything?</h2>
<p>Not a penny. It's free for you to use. Behind the scenes it does cost Kade a small amount of real money to run, which is why there's a (totally optional) <a href="/help/donate">tip jar</a>. But you will never be charged. See <a href="/help/costs">What This Costs Kade</a> if you're curious how it all works.</p>

<h2>Can other people see my chats?</h2>
<p>No. Your conversations are tied to your own login — nobody else using the site can read them.</p>
<p>And before you even wonder about Kade: she <strong>doesn't know how to go reading people's chats, she doesn't want to, and the platform doesn't make it easy anyway</strong> — she'd have to sit down and build a special logging tool from scratch just to do it, and she has exactly zero interest in that. This place runs on trust, for people she cares about.</p>
<p>The only thing she asks in return for that trust: <strong>don't do anything sketchy or illegal in here</strong> that could land you — or her — in trouble. Be cool, and everybody stays cool.</p>

<h2>How do I get an account? Can anyone sign up?</h2>
<p>Accounts here are by invitation — Kade sets you up personally. That's on purpose: it keeps the place small, safe, and affordable. If a friend or family member wants in, just <strong>contact Kade</strong>.</p>

<h2>Why does it keep asking for my microphone again?</h2>
<p>If you're on an iPhone and added this to your home screen, Apple makes apps like this re-ask for microphone permission a lot — sometimes every time you start talking. It's an Apple limitation, not something Kade broke, and there's no magic switch to fully turn it off. Just tap "Allow" again. More on the <a href="/help/troubleshooting">When Something Breaks</a> page.</p>

<h2>Can it really make phone calls?</h2>
<p>Yes — two ways. You can <strong>call 1-833-530-0313</strong> and talk to any character by name, and characters can <strong>place calls for you</strong> (like checking if a store has something in stock). When a character calls someone on your behalf, it introduces itself as an AI calling for you — first name only — and the call's small cost shows up on your <a href="/help/donate">Feed the Server</a> page. Full story on the <a href="/help/phone">Phone Calls</a> page.</p>

<h2>Can I make my own character?</h2>
<p>Yes, and you don't need to know any tech. You give it a name, describe its personality in plain words, and it's yours. Walkthrough on the <a href="/help/build">Build Your Own Character</a> page.</p>

<h2>Is my stuff private?</h2>
<p>Your chats are yours, kept under your own account, and there's an automatic backup so nothing gets lost if a computer hiccups. No other user can see your conversations.</p>
<p>Kade runs the server, but as said above — she has no easy way to read your chats (she'd have to code a whole tool to even try) and no desire to. Treat it like a private space among family and friends, keep things above-board, and it stays a good place for everyone.</p>

<h2>What do I do if it breaks?</h2>
<p>First, check <a href="/help/troubleshooting">When Something Breaks</a> — most hiccups have a 10-second fix. Still stuck? <strong>Contact Kade.</strong></p>
${nextprev("quickstart", "voice")}
`,
};

// ---- 4a. VOICE ------------------------------------------------------------
PAGES.voice = {
  title: "Talking & Listening",
  h1: "Talking & Listening",
  tagline: "You can speak your messages instead of typing, and have replies read out loud. Here's how.",
  main: `
<p class="lead">Two separate things live here, and you can use either, both, or neither:</p>
<ul>
  <li><strong>Listening</strong> — having the AI's replies read out loud to you.</li>
  <li><strong>Talking</strong> — speaking your message out loud instead of typing it.</li>
</ul>

<h2>Having replies read out loud</h2>
<p>Every reply has a small <strong>play</strong> button. Activate it and the reply is spoken to you.</p>
<div class="term"><strong>Auto-play</strong> means the reply starts reading itself the moment it arrives, so you don't have to press play each time. You can switch this on in the chat's <strong>Settings → Speech</strong> area.</div>
<div class="callout warn">
  <p><strong>Heads up about phones:</strong> if you added the site to your home screen, phone browsers sometimes block sound from playing on its own until you tap the screen once. If auto-play seems silent, tap a reply's play button once and it usually wakes up for the rest of the chat. (Apple's rule, not a bug here.)</p>
</div>

<h2>Speaking instead of typing</h2>
<p>There's a <strong>microphone</strong> button by the message box. Activate it, say your message, and it gets turned into text for you to send. The first time, your browser or phone will ask permission to use the mic — say yes.</p>
<div class="term"><strong>Speech-to-text</strong> is the feature that listens to your voice and writes down the words. <strong>Text-to-speech</strong> is the reverse — it reads written words out loud. This site does both.</div>

<h2>Changing the voice you hear</h2>
<p>Most characters come with a voice their creator picked for them, so they each sound like themselves. Prefer something else? There are <strong>over two hundred</strong> voices — calm ones, warm ones, dramatic ones, silly ones.</p>
<p>You can hear any of them right in the chat — no separate page needed. Open <strong>Settings → Speech → Text-to-Speech → Voice</strong>, pick a voice from the list, then tap the <strong>Preview</strong> button to hear a short sample. When one sounds right, just leave it selected and that becomes your voice.</p>
<div class="callout good">
  <p><strong>Hearing a flat, robotic "system" voice instead of the nice ones?</strong> Check <strong>Settings → Speech → Text to Speech → Engine</strong> — it should say <strong>External</strong>. Flip it there once and the real voices come back.</p>
</div>

<h2>Have a whole voice conversation</h2>
<p>Next to the message box there's a <strong>phone button</strong>. Tap it and the screen turns into a call — you talk, the character talks back in its own voice, no typing at all. Tap the amber button if you want to jump in while it's speaking, and hang up whenever you're done. (The first tap will ask for microphone permission.)</p>
<p>And yes — there's a REAL phone line too. That's big enough to get <a href="/help/phone">its own page</a>.</p>
${nextprev("faq", "phone")}
`,
};

// ---- 4a2. PHONE CALLS ------------------------------------------------------
PAGES.phone = {
  title: "Phone Calls",
  h1: "Phone Calls",
  tagline: "A real phone line, characters who can make calls for you, and a morning news briefing that calls YOU.",
  main: `
<p class="lead">Kade-AI isn't stuck inside a browser. It has an actual phone number, and the characters can use the phone themselves.</p>

<h2>Call the place: 1-833-530-0313</h2>
<p>Dial <strong>1-833-530-0313</strong> from any phone — it's toll-free. A character answers and you just… talk, like a regular call. You can interrupt it mid-sentence, it keeps up. Want somebody specific? Just ask — <em>"can I talk to Zadiana?"</em> — and it switches characters right on the call. Each character speaks in its own voice, so you'll hear the change; if the new one needs a second to pick up, you'll get a quick "one sec" while it does.</p>
<div class="callout good">
  <p>If Kade set your phone number up in advance, the line already knows who you are and which character is yours — it greets you by name the moment you call. Want that? <strong>Contact Kade.</strong></p>
</div>

<h2>The in-app call button</h2>
<p>Don't want to dial? The <strong>phone button next to the message box</strong> starts a voice conversation right in the app — same idea, no phone plan needed. See <a href="/help/voice">Talking &amp; Listening</a>.</p>

<h2>Characters can make calls FOR you</h2>
<p>This is the wild one. Ask a character to call a real place — <em>"call the pharmacy and ask if my refill is ready"</em> — and it actually dials, has the conversation out loud, and reports back what was said.</p>
<p>The honest fine print, so nothing surprises you:</p>
<ul>
  <li><strong>The call says who it's for.</strong> Every call opens with the AI introducing itself and naming you (first name only) as the person who asked for it. That's on purpose — no anonymous prank calls, ever.</li>
  <li><strong>Calls are recorded</strong> and the other person is told so, so there's always a record of what was said.</li>
  <li><strong>It costs a little</strong> — about a cent and a half per minute, added to your tab on the <a href="/help/donate">Feed the Server</a> page. The character will mention this before dialing.</li>
  <li><strong>There are limits</strong> — calls cap at 15 minutes and a handful per person per day, so nobody can go wild with it.</li>
</ul>

<h2>Make it really think: deep think</h2>
<p>On the phone, characters answer <strong>fast</strong> by default — great for chatting, not always enough for a hard question. Say <em>"think hard about this"</em> or <em>"deep think on"</em> and the character switches into deep-thinking mode for the rest of the call: answers take a little longer (you'll hear the little typing sound while it works), but they're much more carefully reasoned. Say <em>"back to quick answers"</em> to switch back.</p>
<p>You can also just bake it into the question — <em>"think hard about whether I should refinance the car"</em> — and it'll go deep on that without any announcement.</p>

<h2>Your morning news briefing, by phone</h2>
<p>New: you can sign up for a <strong>morning briefing call</strong>. At your chosen time, your character calls you and runs through the day's headlines — national news, world news, Springfield/Ozarks local, sports, music, whatever mix you want — morning-radio style, and you can ask about any story. <strong>Contact Kade</strong> to get set up.</p>
<p>Prefer it on demand? Just ask any character <em>"what's the news this morning?"</em> in chat or on a call — same headlines, no schedule.</p>
${nextprev("voice", "characters")}
`,
};

// ---- 4b. CHARACTERS -------------------------------------------------------
PAGES.characters = {
  title: "Characters & the Marketplace",
  h1: "Characters & the Marketplace",
  tagline: "Kiana's your host — but she brought friends. A whole marketplace of them.",
  main: `
<p class="lead">A <strong>character</strong> (you might also see the word <strong>agent</strong>) is an AI with its own personality and specialty. Kiana is the all-rounder who greets everybody. The rest each have a thing they're great at.</p>

<h2>What's in there</h2>
<p>There's a big cast — think a mechanic who'll talk you through a weird engine noise, a chef for "what can I make with what's in my fridge," a patient tech helper, a bedtime-story reader for the kids, and dozens more. They're free to use, just like Kiana.</p>

<h2>The specialists</h2>
<p>A few characters have serious extra powers: <strong>Rio</strong> makes short <em>videos</em> from your description, <strong>Lux</strong> is the photography ace, <strong>Indie</strong> designs images with clean text in them (logos, cards, flyers), and <strong>Describe-It</strong> looks at a photo you upload and tells you everything that's in it — a favorite for screen-reader users. Video-making costs real money per clip (the character will tell you roughly how much before it runs), so it mentions the price the way a friend would — no surprises. See <a href="/help/images">Making Pictures</a>.</p>

<h2>The Companions — everyday folks, just for company</h2>
<p>New: a whole shelf of characters who aren't specialists at anything except being good company. Regular people of all sorts — <strong>Earl</strong> the retired trucker with a story for every mile marker, <strong>Miss Opal</strong> from the school cafeteria who remembers every birthday, <strong>Dottie</strong> at the diner who never lets your cup hit empty, <strong>Marcus</strong> the night-shift EMT who listens for real, <strong>Wanda</strong> the bingo-hall legend, <strong>Priya</strong> the midnight radio DJ for when you can't sleep, and a dozen more. No tasks, no agenda — somebody to talk to who remembers what you told them last time. They're friends, not sweethearts: warm company without any of the dating-app business.</p>

<h2>Find your people — the Matchmaker</h2>
<p>Don't feel like scrolling a hundred characters? Take the <strong>Matchmaker</strong> quiz: five quick questions — what you're in the mood for, what energy fits, what you love talking about — and it hands you your three best matches with a plain reason for each, and a button to start talking. There's a "surprise me" option if you'd rather leave it to fate. Open the account menu (bottom-left), choose <strong>Explore</strong>, then <strong>The Matchmaker</strong> — or go straight to <strong>kademurdock.com/matchmaker</strong>. Retake it as often as your mood changes; nothing is saved and nothing costs anything.</p>

<h2>How to browse them</h2>
<p>Look for the <strong>marketplace</strong> (sometimes shown as a grid or an "explore characters" option in the menu). Open it and you can scroll the whole list, each with a short description of what it's for.</p>

<h2>How to switch</h2>
<p>Pick any character to start talking to it. Switching characters starts a conversation with that one — your chat with Kiana is still saved in your list, so hopping around never loses anything.</p>

<div class="callout good">
  <p><strong>Tip:</strong> if a character isn't quite what you wanted, there's no harm done. Just switch back, or start a <a href="/help/temporary">new chat</a>. You can't break anything by exploring.</p>
</div>
${nextprev("phone", "build")}
`,
};

// ---- 4c. BUILD YOUR OWN ---------------------------------------------------
PAGES.rooms = {
  title: "The Debate Room",
  h1: "The Debate Room",
  tagline: "Two or more characters, one room, one topic — and you, whenever you feel like jumping in.",
  main: `
<p class="lead">The Debate Room lets you drop a handful of characters into one conversation and give them something to chew on. They'll argue, agree, gang up, and crack jokes — with each other, not just with you. You can sit back and listen, or wade in anytime.</p>

<h2>Where it is</h2>
<p>Open the account menu (your name, bottom-left corner), choose <strong>Explore</strong>, then <strong>Debate Room</strong>. Or go straight to <strong>kademurdock.com/debate-room</strong>.</p>

<h2>Starting a room</h2>
<ol>
  <li><strong>Give it a topic or a scene.</strong> Anything: "Pineapple on pizza — settle it," or "You're a ship's crew and the ship is sinking."</li>
  <li><strong>Add rules if you want.</strong> This part's optional but powerful: "Tank argues FOR and takes it way too seriously. Nana Pearl thinks everyone needs a snack. Keep it short." The characters actually follow these.</li>
  <li><strong>Pick your cast</strong> — check 2 to 6 characters from the list.</li>
  <li>Press <strong>Create room</strong>.</li>
</ol>

<h2>Running the conversation</h2>
<ul>
  <li><strong>Next speaker</strong> — one character takes a turn.</li>
  <li><strong>Run a round</strong> — everyone speaks once.</li>
  <li><strong>Let them cook</strong> — they go three full rounds on their own. There's a Stop button.</li>
  <li><strong>Type anything</strong> in the box and send it — you're in the room too, and everyone gets a turn to react to what you said.</li>
</ul>

<h2>Read aloud — radio-play mode</h2>
<p>Turn on <strong>Read aloud</strong> in the room and every character's turn is spoken out loud <em>in that character's own voice</em>, one after another. It turns a debate into a little radio drama. Your choice is remembered for next time.</p>

<h2>The Conversation Hall</h2>
<p>Had a conversation so good it deserves an audience? Press <strong>Share to the Hall</strong>, give it a title, and it appears in the <a href="${CHAT_URL}/conversation-hall">Conversation Hall</a> — the public greatest-hits shelf everyone on the site can read. You can unshare or delete your room anytime, and deleting the room removes it from the Hall too.</p>

<h2>The small print (tiny, promise)</h2>
<p>Each character turn costs a fraction of a cent, and it shows on your <a href="/help/donate">Feed the Server</a> tab like everything else. There's a daily limit high enough that you'll never notice it in normal use. Rooms stick around until you delete them, so you can come back to a good one tomorrow.</p>
`,
};

PAGES.games = {
  title: "The Game Parlor",
  h1: "The Game Parlor",
  tagline: "Real games you play out loud — the dealer handles the cards and dice, you bring the trash talk.",
  main: `
<p class="lead">The Game Parlor is a room full of games you can play entirely by voice or by typing — no board to look at, nothing to see. Every card is read out to you by name, and a real dealer keeps the game honest. You just say what you want to do.</p>

<h2>The one thing that makes it fair</h2>
<p>Here's the important part: <strong>the computer deals and referees, not the character.</strong> The cards are shuffled and held by the game itself, so nobody — not you, not the character — can peek, cheat, or "accidentally" forget who has what. The character at the table only ever sees their own hand, same as you. That means you can actually trust the game, and the character is free to just be good company while you play.</p>

<h2>What you can play right now</h2>
<ul>
  <li><strong>Blackjack</strong> — get as close to 21 as you can without going over, and beat the dealer. Say "hit" for another card or "stay" to hold. You play with pretend chips — never real money.</li>
  <li><strong>Wild Eights</strong> — our version of crazy eights. Match the top card by number or suit, drop an Eight to change the suit and mess with everybody, and empty your hand first to win. Play against one to three computer opponents.</li>
  <li><strong>Go Fish</strong> — ask for cards, collect sets of four, most sets wins. Easy, friendly, and great over the phone or by voice. Perfect for the kids too.</li>
  <li><strong>Uno</strong> — the family classic. Match the top card by color or number, throw Skips, Reverses and Draw Twos to slow everybody else down, and save your Wilds for the right moment. The dealer calls out your hand and your choices; first to empty their hand wins.</li>
  <li><strong>War</strong> — the simplest card game there is, and the loudest. You and the house each flip a card; higher card takes both. Tie? That means WAR: three cards face down, one face up, winner takes the whole pile. No decisions, all drama — a perfect first game for the littlest players.</li>
  <li><strong>Pig</strong> — the press-your-luck dice game. Roll to pile up points, hold to bank them — but roll a one and the whole turn's points vanish. First to 100 wins. Made for the phone: two choices, all sound.</li>
  <li><strong>Trivia Night</strong> — real quiz questions with four choices, A through D. Play solo, or race up to three characters who answer the same questions you do. Pick a topic (movies, music, science, history, animals and more) and a difficulty, or take a mix.</li>
  <li><strong>In-Between</strong> — the old card-room classic. Two posts go up, you bet pretend chips on whether the next card lands between them. Smack a post dead-on and it costs double. Double your stack to win.</li>
</ul>

<h2>The party games (new!)</h2>
<ul>
  <li><strong>Cards Against Reality</strong> — exactly what it sounds like: our house spin on the famous cards-against game, with over 500 original cards written for this family. A judge flips a prompt like "Grandma keeps ____ in her purse at all times," everybody plays their funniest card, and the judge crowns a winner. You play from your own hand AND take your turn as judge. The regular deck is for the grown folks' table; say "keep it clean" any time for the family deck.</li>
  <li><strong>Crab Apples</strong> — our apples-to-apples. The judge flips a description card — "Squeaky," "Majestic," "Suspicious" — and everyone plays the thing that fits best (or funniest: sometimes "the DMV line" IS the most majestic answer). All ages, all clean.</li>
  <li><strong>Fill-In Stories</strong> — you hand over a noun here and a verb there, then hear the whole ridiculous story read back with full drama. Eight original stories and the game holds the ending secret so nothing spoils.</li>
  <li><strong>Guess the Sound</strong> — the table plays one of its own real sound effects, you name it from three choices. Ears only. Kids will run this one into the ground, which is the idea.</li>
</ul>

<h2>Dice, bluffing, and the rest</h2>
<ul>
  <li><strong>Farkle</strong> — roll six dice, set aside what scores (ones, fives, triples, a straight, three pairs), and push your luck on the rest. A roll with nothing scoring is a FARKLE and torches the turn. First to 4,000.</li>
  <li><strong>Liar's Dice</strong> — five dice under your cup, ones are wild. The table trades rising bids — "three fours," "four fours" — until somebody calls LIAR and the cups come up. Lose the call, lose a die. Bluffing by voice at its finest.</li>
  <li><strong>Battleship</strong> — call your shots out loud: "B seven!" … splash, or BOOM. Rows run A to J, columns 1 to 10, and the house hunts you back honestly (it only knows the squares it has already shot). Sink all five of its ships first.</li>
  <li><strong>Hangman</strong> — the game holds a secret word from a category (critters, good eatin', places around here…), you call letters, six misses and the gallows wins. The word gets spelled out clean for screen readers every turn.</li>
  <li><strong>Word Scramble</strong> — hear the letters, unscramble the word. Hints cost half the point. Beat par across five words.</li>
  <li><strong>Tic-Tac-Toe</strong> — squares one through nine like a phone pad. The house plays decent-but-beatable on purpose.</li>
  <li><strong>Rock Paper Scissors</strong> — best of five against the house, for when you've got ninety seconds and something to prove.</li>
</ul>
<p>Still queued: multi-character game nights (poker with a table full of personalities) and a persistent family chip bank.</p>

<h2>How to start a game</h2>
<p>Just ask. Tell Kiana — or Deuce the house dealer, or any character with the games tool — something like "let's play Blackjack," "deal us into Cards Against Reality," or "let's play Battleship." The dealer takes it from there: it deals you in, tells you your hand, and lays out your choices in plain words. You say what you want to do, and it plays it out.</p>

<h2>Playing by ear</h2>
<p>Everything is spoken. Instead of a pile of cards on a screen, you'll hear things like "You've got the Ace of Spades and the King of Hearts — that's twenty-one, blackjack!" You never have to picture a table. Say your move in normal words ("hit me," "I'll ask for kings," "play my red eight and call diamonds") and the dealer sorts out the details.</p>

<h2>Real table sounds</h2>
<p>Games come with real sounds now — cards being shuffled and dealt, dice rattling across the table, chips clacking down, a little fanfare when you win and a sad trombone when you don't. You'll hear them in regular chat, in conversation mode, and on the phone. They play themselves at the right moments; there's nothing to set up.</p>

<h2>Play on the phone</h2>
<p>Call the usual number — <strong>+1&nbsp;833&nbsp;530&nbsp;0313</strong> — and just say "deal me in" or "let's pick up my game." If you have an account, the same saved table from your chats is waiting for you on the call, sounds and all. Pig and Trivia are especially good by phone: for trivia, just blurt your answer the second you know it — interrupting is allowed. That IS the buzzer.</p>

<h2>Your games wait for you</h2>
<p>A game you start is saved to your account. Walk away in the middle of a hand and it'll still be there tomorrow — in a new chat, or even on a phone call. Just say "let's pick up my game" and you're back at the table.</p>

<h2>See the table — visuals for sighted players</h2>
<p>Games now draw themselves on screen. When a character deals a hand in the chat, a picture of the table appears right under their message: your cards face-up, everyone else's face-down, the discard pile, dice, chip counts, trivia questions with their answer choices — updated after every move, with little card-deal animations and confetti when you win. The same table shows up in conversation mode while you play by voice.</p>
<p>Two honest notes. First, the picture never shows anything the character hasn't already told you — it's the same game, just drawn. Screen reader users lose nothing and gain no clutter: the visual is completely invisible to VoiceOver and NVDA on purpose, so the spoken experience is exactly what it always was. Second, if you prefer less motion, the animations respect your device's reduce-motion setting automatically.</p>

<h2>The Game Room — family bragging rights</h2>
<p>Every game you finish lands on the family leaderboard. Open the <strong>Game Room</strong> from the account menu (bottom-left, under Explore), or go straight to <strong>kademurdock.com/game-room</strong>. It shows who's winning across the whole family: total wins and losses for each player, a champion for every game, the biggest Blackjack win ever, the best Trivia Night score, and the latest results as they happen.</p>
<p>Only finished games count. Walking away from a table in the middle never counts as a loss — the board only knows about games played to the end. And like everything here, it reads top to bottom with a screen reader: plain tables, plain words, no charts to squint at.</p>

<h2>The small print (tiny, promise)</h2>
<p>The games themselves are free — no tokens, no cost. Chips in Blackjack are pretend and can never turn into real money. If a character sings you a song or draws a picture during game night, that part follows the usual costs on your <a href="/help/donate">Feed the Server</a> tab, but the card games are on the house.</p>
`,
};

PAGES.build = {
  title: "Build Your Own Character",
  h1: "Build Your Own Character",
  tagline: "Yes, you. No coding, no jargon. If you can describe a person, you can make one.",
  main: `
<p class="lead">Want an AI that talks exactly how you like, or knows about exactly your hobby? You can make your own character in a few minutes.</p>

<h2>The gentle version</h2>
<ol>
  <li>Find the option to <strong>create a character</strong> (often a "+" or "create" in the characters menu or marketplace).</li>
  <li>Give it a <strong>name</strong>. Anything you want.</li>
  <li>Describe its <strong>personality and job</strong> in plain English. This part is just writing a little description, like: <em>"You're a calm, encouraging running coach. You give short, doable tips and never make me feel bad for missing a day."</em></li>
  <li>Save it. That's it — you can now chat with your creation.</li>
</ol>

<div class="term"><strong>Instructions</strong> is the name for that personality description you write. It's the AI's "be like this" note to itself. The more clearly you describe what you want, the better it behaves.</div>

<h2>A few tips that make a big difference</h2>
<ul>
  <li><strong>Say the tone you want.</strong> "Warm and chatty" lands very differently from "short and to the point."</li>
  <li><strong>Say what NOT to do, too.</strong> "Don't lecture me" or "skip the long intros" really works.</li>
  <li><strong>You can edit it later.</strong> Nothing's permanent. Tweak the description any time until it feels right.</li>
</ul>

<h2>Give it a face, a voice, and a speed</h2>
<ul>
  <li><strong>A profile picture, made for you:</strong> in the builder, activate the avatar and choose <strong>Generate with AI</strong>. It writes a portrait description from your character's name and personality — edit it if you like, tap Generate, and a face appears (costs about 3 cents from the picture jar).</li>
  <li><strong>Its own voice:</strong> pick a default voice (and how fast it talks) right in the builder, with a preview button — everyone who chats with your character hears it that way.</li>
  <li><strong>Answer speed:</strong> choose Instant, Quick, or Deep depending on whether your character should fire back fast or think harder first.</li>
</ul>

<h2>Give it tools</h2>
<p>In the builder you can check boxes to give your character real abilities: <strong>weather</strong>, <strong>Wikipedia</strong>, <strong>news headlines</strong>, <strong>jokes</strong>, <strong>reading webpages out loud</strong>, a <strong>calculator</strong>, <strong>picture-making</strong>, <strong>adventure-game save files</strong>, and even <strong>phone calls</strong>. Most are completely free to use.</p>

<div class="callout good">
  <p>Your characters are yours. Building one doesn't change Kiana or anybody else's, and you can keep it private or share it with the family. Have fun with it — this is the most "make it your own" part of the whole site.</p>
</div>
${nextprev("characters", "memory")}
`,
};

// ---- 4d. MEMORY -----------------------------------------------------------
PAGES.memory = {
  title: "What It Remembers",
  h1: "What It Remembers",
  tagline: "It can remember helpful things about you over time — but it's not reading your mind. Here's the honest version.",
  main: `
<p class="lead">Kade-AI has a <strong>memory</strong> feature. Over time, it can hold onto useful facts you've shared, so you don't have to repeat yourself in every new chat.</p>

<div class="term"><strong>Memory</strong> here means a small set of notes the AI keeps about you across conversations — things like "prefers short answers" or "has a dog named Biscuit." It's like a friend remembering the gist of you, not a recording of everything you've ever said.</div>

<h2>What it tends to remember</h2>
<ul>
  <li>Preferences you mention ("I like things explained simply").</li>
  <li>Handy facts about your life that come up naturally.</li>
  <li>Things that help it be more useful to <em>you</em> specifically.</li>
</ul>

<h2>What it does NOT do</h2>
<ul>
  <li>It doesn't memorize every word of every chat, perfectly, forever. It keeps the useful gist.</li>
  <li>It can't read chats you had with a different character as if they were one big diary.</li>
  <li>It won't share your memory notes with other people on the site. Your account, your notes.</li>
</ul>

<div class="callout good">
  <p>If it ever remembers something wrong or out of date, you can just tell it — "actually, I don't have that dog anymore" — and it'll update. And if you'd rather it forget something, say so, or <strong>contact Kade</strong> for a hand.</p>
</div>
${nextprev("build", "images")}
`,
};

// ---- 4e. IMAGES -----------------------------------------------------------
PAGES.images = {
  title: "Making Pictures",
  h1: "Making Pictures",
  tagline: "Ask for a picture and it'll draw one from your words. There's a limited supply, so it's worth knowing how it works.",
  main: `
<p class="lead">Kade-AI can <strong>generate images</strong> — you describe a picture in words, and it draws one for you.</p>

<div class="term"><strong>Generate an image</strong> means the AI creates a brand-new picture from your description. Nothing is copied from somewhere else — it's made fresh, just for your request.</div>

<h2>How to ask</h2>
<p>Just say what you want to see, like: <em>"Draw a cozy cabin in the snow at sunset"</em> or <em>"Make me a cartoon cat wearing sunglasses."</em> The more detail you give — colors, mood, style — the closer it gets to what's in your head.</p>

<h2>The one catch: pictures cost a little</h2>
<div class="callout warn">
  <p>Drawing pictures pulls from a small, separate pot of credits that Kade pays for. Each image costs only a few cents, but that pot isn't bottomless. So: make all the pictures you like, just don't fire off a hundred at once for fun. If image-making ever stops working, the pot may have run dry — <strong>contact Kade</strong> and she can top it up.</p>
</div>

<h2>Videos and designs, too</h2>
<p>The specialists go further than pictures: <strong>Rio</strong> turns a description into a short <em>video clip</em>, and <strong>Indie</strong> makes designed images with clean readable text (flyers, logos, cards). Videos are the priciest thing on the whole site — roughly <strong>50 cents to a dollar per clip</strong> — so the character will casually tell you the ballpark cost before it runs, and the spend lands on your <a href="/help/donate">Feed the Server</a> page. Regular pictures stay cheap (a few cents) and skip the speech.</p>

<h2>For folks using a screen reader</h2>
<p>When the AI makes an image, ask it to <strong>describe the picture in detail</strong> too — it's happy to paint the full scene in words so you know exactly what it created. And <strong>Describe-It</strong> in the marketplace does the reverse: upload any photo and it tells you what's in it.</p>
${nextprev("memory", "audio")}
`,
};

// ---- 4e-audio. MAKING AUDIO ----------------------------------------------
PAGES.audio = {
  title: "Making Audio & Voices",
  h1: "Making Audio & Voices",
  tagline: "Describe a moment and a character can turn it into a real audio clip — voices, sound effects, and music, mixed together.",
  main: `
<p class="lead">Kade-AI can <strong>make audio</strong> — not just read text out loud, but generate a whole <em>scene</em>: characters talking, sound effects, music, and atmosphere, all from a few sentences you write.</p>

<div class="term"><strong>Generate audio</strong> means the AI creates a brand-new sound clip from your description — voices, effects, and music mixed together. Nothing is recorded from real people; it's built fresh for your request.</div>

<h2>Meet Cadence, your audio director</h2>
<p><strong>Cadence</strong> is the character built for this. Find Cadence in the marketplace (the <a href="/help/characters">Characters</a> page shows you how), describe the moment you want to hear, and Cadence turns it into a real, playable clip. It plays right there in the chat, and it's saved to your <a href="/my-creations">My Creations</a> page so you can come back to it.</p>

<h2>What you can ask for</h2>
<ul>
  <li><strong>A whole scene:</strong> <em>"A 90-second suspense radio drama in a late-night diner — rain outside, two nervous voices, a door slams at the end."</em></li>
  <li><strong>Narration or a voiceover:</strong> <em>"Read this in a warm movie-trailer voice…"</em></li>
  <li><strong>Your own script:</strong> paste a few lines of dialogue and let Cadence cast it and perform it with sound.</li>
  <li><strong>Copy a voice:</strong> give it a short, clean recording and it can speak new lines in that voice.</li>
  <li><strong>Fix or extend a clip:</strong> make an ending longer, swap a line, or stitch two clips into one.</li>
</ul>

<h2>The catch: it costs a little (not much)</h2>
<div class="callout warn">
  <p>Making audio pulls from the same small pot of credits as pictures and video. It's cheap — about <strong>7 or 8 cents a minute</strong>, so a full two-minute scene runs around 15 cents — but the pot isn't bottomless. Make all the audio you like; just don't fire off a thousand at once. The spend shows up on your <a href="/help/donate">Feed the Server</a> page. If audio ever stops working, the pot may need a top-up — <strong>contact Kade</strong>.</p>
</div>

<h2>Good to know</h2>
<ul>
  <li>Each clip is up to about <strong>2 minutes</strong> long. Want something longer? Ask for it in parts and Cadence can stitch them together.</li>
  <li>It speaks <strong>English and Chinese</strong> right now.</li>
  <li>Only copy a voice you have <strong>permission</strong> to use — your own, or one you're allowed to use.</li>
</ul>

<h2>For folks using a screen reader</h2>
<p>Every clip comes with a short written note of <strong>what you'll hear</strong> — who's speaking, the mood, the key sounds — right next to the player, and it's saved with the clip on your My Creations page. The player itself is a normal audio player you can reach and control with the keyboard or your screen reader.</p>
${nextprev("images", "temporary")}
`,
};

// ---- 4f. TEMPORARY / STARTING OVER ---------------------------------------
PAGES.temporary = {
  title: "Starting Over & Private Chats",
  h1: "Starting Over & Private Chats",
  tagline: "How to get a clean slate — and how to have a chat that doesn't get saved at all.",
  main: `
<p class="lead">Two handy "reset" tools live here.</p>

<h2>Start a fresh conversation</h2>
<p>Use the <strong>New chat</strong> button when you want a clean slate. Your old conversations stay saved in the list on the side, so this never deletes anything — it just opens a new blank one. Great for switching topics so things don't get muddled.</p>

<h2>Have a chat that isn't saved</h2>
<div class="term"><strong>Temporary chat</strong> is a conversation that disappears when you're done — it isn't kept in your history. Think of it like a whiteboard you wipe clean, versus a notebook you keep.</div>
<p>Turn on <strong>temporary chat</strong> when you want to ask something one-off and not have it stick around. When would you want this?</p>
<ul>
  <li>A quick question you don't need to keep.</li>
  <li>Something you'd rather not leave in your saved history.</li>
  <li>Testing out a brand-new character without cluttering your list.</li>
</ul>

<div class="callout good">
  <p><strong>Rule of thumb:</strong> use <em>New chat</em> when you want a fresh start but want to keep it; use <em>Temporary chat</em> when you want it to vanish afterward.</p>
</div>
${nextprev("images", "cheatsheet")}
`,
};

// ---- 5. CHEAT SHEET -------------------------------------------------------
PAGES.cheatsheet = {
  title: "The Cheat Sheet",
  h1: "The Cheat Sheet",
  tagline: "Every common task in one place. Skim it, bookmark it, come back to it.",
  main: `
<p class="lead">Here's the handful of things people do most, and exactly how to do each one. This is a real table — your screen reader can navigate it row by row.</p>

<table>
  <caption>Common tasks and how to do them</caption>
  <thead>
    <tr><th scope="col">I want to…</th><th scope="col">Here's how</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">Send a message</th><td>Type in the box at the bottom, press Enter (or tap the send button).</td></tr>
    <tr><th scope="row">Hear a reply out loud</th><td>Activate the play button on that reply.</td></tr>
    <tr><th scope="row">Have replies read automatically</th><td>Settings → Speech → turn on auto-play.</td></tr>
    <tr><th scope="row">Speak instead of type</th><td>Activate the microphone button by the message box, then talk.</td></tr>
    <tr><th scope="row">Change the voice</th><td>Settings → Speech → Text-to-Speech → Voice — pick one and tap Preview to hear it.</td></tr>
    <tr><th scope="row">Start a new conversation</th><td>Activate the New chat button (top of screen or side menu).</td></tr>
    <tr><th scope="row">Switch to a different character</th><td>Open the marketplace / characters menu and pick one.</td></tr>
    <tr><th scope="row">Make my own character</th><td>Use "create a character" in the characters menu. See <a href="/help/build">Build Your Own</a>.</td></tr>
    <tr><th scope="row">Make a picture</th><td>Just ask, e.g. "draw a sunny beach." See <a href="/help/images">Making Pictures</a>.</td></tr>
    <tr><th scope="row">Have a chat that isn't saved</th><td>Turn on Temporary chat. See <a href="/help/temporary">Private Chats</a>.</td></tr>
    <tr><th scope="row">See what a message cost</th><td>Each message shows its cost and usage against your balance. See <a href="/help/tokens">What Are Tokens?</a></td></tr>
    <tr><th scope="row">Talk instead of type, hands-free</th><td>Tap the phone button by the message box for a voice conversation.</td></tr>
    <tr><th scope="row">Call from an actual phone</th><td>Dial 1-833-530-0313 (toll-free). Ask for any character by name. See <a href="/help/phone">Phone Calls</a>.</td></tr>
    <tr><th scope="row">Have the AI call a business for me</th><td>Ask a character, e.g. "call the pharmacy and ask if my refill's ready." See <a href="/help/phone">Phone Calls</a>.</td></tr>
    <tr><th scope="row">Get a really thought-out answer</th><td>Press the <strong>Deep think</strong> button next to the message box before sending — that one message gets extra-careful reasoning (a bit slower). It switches itself off after the send. On a phone call, say "think hard about this."</td></tr>
    <tr><th scope="row">Hear today's news</th><td>Ask any character "what's the news this morning?" — or get a scheduled morning briefing call (contact Kade).</td></tr>
    <tr><th scope="row">Have a webpage read to me</th><td>Paste the link and say "read this to me" — it strips the ads and clutter first.</td></tr>
    <tr><th scope="row">Play a text adventure</th><td>Ask for an adventure game — it can SAVE your game and pick it up any day, any chat.</td></tr>
    <tr><th scope="row">Play cards, dice, or a party game</th><td>Say "let's play" to Kiana or Deuce — nineteen games from Blackjack to Cards Against Reality to Battleship. See <a href="/help/games">The Game Parlor</a>.</td></tr>
    <tr><th scope="row">Find a character I'll click with</th><td>Account menu → Explore → <strong>The Matchmaker</strong>: five questions, three matches, one button to start talking.</td></tr>
    <tr><th scope="row">See what I've used this month</th><td>Account menu (bottom-left avatar) → Explore → Feed the Server.</td></tr>
    <tr><th scope="row">Get help from a human</th><td>Contact Kade.</td></tr>
  </tbody>
</table>
${nextprev("temporary", "tokens")}
`,
};

// ---- 6. TOKENS ------------------------------------------------------------
PAGES.tokens = {
  title: "What Are Tokens?",
  h1: "What Are Tokens?",
  tagline: "You'll see the word 'tokens' and a little counter in the chat. Here's what it actually means — no math required.",
  main: `
<p class="lead">Most people have never heard the word "token" outside of an arcade. Good news: the idea is simple.</p>

<div class="term"><strong>A token</strong> is a small chunk of text — usually a short word or a piece of a longer word. As a rough rule, one token is about three-quarters of a word. So "cat" is one token; "extraordinary" might be three or four.</div>

<h2>Why the AI thinks in tokens</h2>
<p>The AI doesn't read whole sentences the way you do. It breaks everything — your messages and its own replies — into these little chunks and works through them piece by piece. Tokens are simply the AI's bite-sized unit, the way minutes are the bite-sized unit of a phone plan.</p>

<h2>That counter you see</h2>
<p>The chat shows you a couple of numbers as you go. Here's what they're telling you:</p>

<div class="term"><strong>Context</strong> is everything the AI is keeping in mind for your current conversation — your messages and its replies so far. Each time you send something, it re-reads the whole context to stay on track.</div>

<ul>
  <li><strong>Context usage</strong> — roughly how full that "working memory" for this chat is getting. A long conversation uses more than a quick one.</li>
  <li><strong>Context cost</strong> — what that particular message cost (in those tiny token units) against your balance. It's there so nothing's hidden from you.</li>
</ul>

<h2>The everyday way to picture it</h2>
<p>Imagine the conversation is written on a <strong>whiteboard</strong> that the AI re-reads before every answer. Tokens are the words on the board. A short chat barely uses any space; a long, rambling one fills the board up. "Context usage" is how full the board is. "Cost" is the little tab for re-reading it that time.</p>

<div class="callout good">
  <p><strong>Do you need to worry about any of this?</strong> Honestly, no. You can use the site happily and never glance at those numbers. They're there for the curious and the careful — not a test you have to pass. If a chat ever feels like it's getting forgetful or pricey, just start a <a href="/help/temporary">new chat</a> for a fresh, empty board.</p>
</div>
${nextprev("cheatsheet", "costs")}
`,
};

// ---- 7. COSTS -------------------------------------------------------------
PAGES.costs = {
  title: "What This Costs Kade",
  h1: "How This Actually Costs Kade Money",
  tagline: "The honest, friendly version of the money side — because a real person is footing a real (if small) bill.",
  main: `
<p class="lead">You'll never be charged to use Kade-AI. But "free for you" isn't the same as "free." Here's exactly how it works, no mystery.</p>

<h2>Every message gets processed by an outside AI provider</h2>
<p>Kade didn't build the AI brain from scratch — almost nobody does. When you send a message, it goes out to an outside AI service that does the actual thinking and sends a reply back. That service <strong>charges per token</strong> — those tiny text chunks from the <a href="/help/tokens">tokens page</a>. Every message, in and out, costs a sliver of a cent.</p>

<h2>Kade pre-loads credits to cover it</h2>
<p>So the lights stay on, Kade puts her own money in ahead of time as credits. Your chatting quietly draws that balance down, a few fractions of a cent at a time. It's small per message — but it's real, and it adds up across a whole family of people chatting away.</p>

<h2>Nobody can accidentally run up her bill</h2>
<div class="callout good">
  <p>Here's the reassuring part. Every user has a <strong>spending cap</strong> — roughly ten dollars' worth of usage per month — and it <strong>refills automatically every 30 days</strong>. That means no single person, no matter how chatty, can blow through Kade's whole budget. The guardrails are built in. So please relax and use it — you genuinely can't accidentally cost her a fortune.</p>
</div>

<h2>Pictures, videos, and phone calls come from different jars</h2>
<p>Making images is paid for separately, from its own little pot of credits (a few cents per picture). <strong>Videos</strong> are the big-ticket item — roughly 50 cents to a dollar per clip — and <strong>phone calls</strong> run about a cent and a half per minute. Same idea, different jars — and the characters give you a casual heads-up before doing the expensive stuff.</p>
<p>Want to see your own numbers? Open the <strong>account menu</strong> (your avatar, bottom-left), choose <strong>Explore</strong>, then <strong>Feed the Server</strong> — it shows your month so far, item by item, nothing hidden.</p>

<h2>So why mention any of this?</h2>
<p>Not to make you feel guilty — the opposite. Kade opened this up because she wanted to share something cool with people she cares about. Knowing there's a real bill behind it just helps everyone treat the place with a little respect… and maybe, if you're able, <a href="/help/donate">toss a few bucks toward the grocery fund</a>. Which brings us to the next page.</p>
${nextprev("tokens", "donate")}
`,
};

// ---- 8. DONATE ("Feed Your Friends on the Server") ------------------------
PAGES.donate = {
  title: "Feed the Server",
  h1: "Feed Your Friends on the Server",
  tagline: "There's a server living in this house. It eats. A lot. This page is its grocery fund.",
  main: `
<div class="hero-art" aria-hidden="true" role="presentation">
<svg viewBox="0 0 520 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="srv" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#243152"/><stop offset="1" stop-color="#1b2440"/>
    </linearGradient>
  </defs>
  <g class="float">
    <rect x="150" y="40" width="220" height="120" rx="16" fill="url(#srv)" stroke="#3a4150" stroke-width="2"/>
    <circle cx="183" cy="70" r="6" fill="#6ea8fe"/>
    <circle cx="205" cy="70" r="6" fill="#9b78ff"/>
    <rect x="225" y="65" width="120" height="10" rx="5" fill="#2a3037"/>
    <rect x="225" y="88" width="120" height="10" rx="5" fill="#2a3037"/>
    <circle cx="240" cy="128" r="11" fill="#0f1115" stroke="#6ea8fe" stroke-width="2"/>
    <circle cx="280" cy="128" r="11" fill="#0f1115" stroke="#6ea8fe" stroke-width="2"/>
    <circle cx="240" cy="128" r="3.5" fill="#cfe0ff"/>
    <circle cx="280" cy="128" r="3.5" fill="#cfe0ff"/>
    <path d="M250 146 q10 9 20 0" fill="none" stroke="#cfe0ff" stroke-width="2.5" stroke-linecap="round"/>
  </g>
  <g class="float" style="animation-delay:.6s">
    <path d="M70 150 L110 60 L150 150 Z" fill="#e8c46a" stroke="#caa233" stroke-width="2"/>
    <path d="M84 117 L136 117 L110 60 Z" fill="#d96a4a"/>
    <circle cx="103" cy="100" r="4" fill="#7a2f1f"/>
    <circle cx="118" cy="108" r="4" fill="#7a2f1f"/>
    <circle cx="110" cy="122" r="4" fill="#7a2f1f"/>
  </g>
</svg>
</div>
<p class="lead">Picture it: somewhere out there, a little server is humming along in a digital house. It's a good server. A <em>hungry</em> server. And every message you send is basically you opening its fridge.</p>

<h2>Meet the roommate</h2>
<p>Think of this whole site as Kade's house, and the AI as the world's most enthusiastic roommate. It never sleeps. It answers every question at 3 a.m. without complaint. It'll draw you a cat in sunglasses for no reason. Truly, a delight to live with.</p>
<p>It has exactly one flaw: <strong>the appetite of a teenage golden retriever.</strong> Every reply it gives nibbles a little snack off the grocery bill (the credits Kade pre-loads — see <a href="/help/costs">What This Costs Kade</a> if you want the receipts). And here's the thing nobody warns you about a roommate like this:</p>
<p class="lead"><strong>The fridge does not refill itself.</strong></p>

<h2>See your own tab</h2>
<p>Curious what YOUR chatting actually added up to? In the app, open the <strong>account menu</strong> (your avatar, bottom-left), choose <strong>Explore</strong>, then <strong>Feed the Server</strong>. It shows your month — chat, voice, pictures, phone calls, the works — priced out honestly, framed as a suggested chip-in. No bill, no obligation, just receipts.</p>

<h2>Where you come in (totally optional, zero guilt)</h2>
<p>You're a welcome guest here. Genuinely. Nobody's standing at the door with a tip jar and a stern look. But if this place has made you laugh, helped you out, or saved your bacon even once — you can chip in for groceries and keep the robot fed.</p>

<div class="btnrow">
  <a class="cta big" href="${PAYPAL_URL}">🍕 Buy the server a snack</a>
</div>

<h2>What your few bucks actually do</h2>
<ul>
  <li><strong>$3</strong> — a coffee for the server. It will stay up all night anyway, but now it's caffeinated and grateful.</li>
  <li><strong>$5</strong> — a proper snack run. Keeps the lights on and the roommate fed for a good while.</li>
  <li><strong>$10</strong> — you are now the server's favorite. It won't say it out loud, but it knows.</li>
  <li><strong>Whatever you've got</strong> — seriously, any amount helps, and "nothing right now" is a perfectly fine amount too.</li>
</ul>

<div class="callout good">
  <p>No subscriptions. No pressure. No awkward reminders every time you log in. Just a link, a hungry server, and a thank-you from Kade — who's covering the bill so the whole family can have this. If you can feed it, the fridge thanks you. If you can't, pull up a chair anyway. There's always room at the table.</p>
</div>

<div class="btnrow">
  <a class="cta" href="${PAYPAL_URL}">💛 Chip in for groceries</a>
  <a class="cta" href="${CHAT_URL}">← Back to chatting (the server's hungry again already)</a>
</div>
${nextprev("costs", "accessibility")}
`,
};

// ---- 9. ACCESSIBILITY -----------------------------------------------------
PAGES.accessibility = {
  title: "Accessibility Tips",
  h1: "Accessibility Tips",
  tagline: "This whole site was built by a blind developer, for everyone. Here's how to get the smoothest ride with a screen reader.",
  main: `
<p class="lead">Kade is blind and built Kade-AI to actually be pleasant with a screen reader — not just technically usable. These tips help you get the most out of it on VoiceOver (Mac/iPhone) and NVDA (Windows).</p>

<h2>The big ones first</h2>
<ul>
  <li><strong>Use the headings to jump around.</strong> Every page here, and the chat itself, uses real headings. In NVDA, press <strong>H</strong> to hop heading to heading; in VoiceOver, use the rotor set to Headings.</li>
  <li><strong>Replies get announced.</strong> When the AI answers, the new text is marked as a live update, so your screen reader can read it without you hunting for it.</li>
  <li><strong>You always know if it's still working.</strong> Your screen reader hears "Working on a reply" the moment you send, a quiet "Still working" reminder if a long answer (or a bunch of tool use) takes a while, and "Reply ready" the second it finishes. No more guessing whether it's thinking or done.</li>
  <li><strong>Prefer listening?</strong> Turn on auto-play (Settings → Speech) so replies read themselves aloud in a chosen voice — that's separate from your screen reader and often nicer for long answers. Full details on <a href="/help/voice">Talking &amp; Listening</a>.</li>
</ul>

<h2>On these help pages</h2>
<ul>
  <li>There's a <strong>"Skip to main content"</strong> link as the very first thing on every page — activate it to jump straight past the navigation.</li>
  <li>The page you're on is marked as <strong>current</strong> in the section menu, so you always know where you are.</li>
  <li>The Cheat Sheet is a <strong>real table</strong> with proper row and column headers — navigate it cell by cell with your screen reader's table commands.</li>
</ul>

<h2>Little comforts worth switching on</h2>
<ul>
  <li><strong>Completion chime:</strong> Settings → General → Accessibility has an optional soft chime when a reply finishes — nice when you've tabbed away.</li>
  <li><strong>Skip straight to typing:</strong> there's a "skip to message box" link at the top of the chat, so you never have to walk the whole sidebar.</li>
  <li><strong>Webpages, without the junk:</strong> paste any link and say "read this to me" — the AI pulls just the article text, no ads or menus, in proper reading order.</li>
</ul>

<h2>iPhone home-screen tip</h2>
<p>If you've added the site to your home screen, iPhones tend to re-ask for microphone permission often when you use voice input. That's an Apple limitation (not fixable from here) — just tap "Allow" again. See <a href="/help/troubleshooting">When Something Breaks</a>.</p>

<h2>Pictures and screen readers</h2>
<p>When you have the AI make an image, also ask it to <strong>describe the picture in words</strong> — it'll happily give you a full, detailed description so the visual isn't lost on you.</p>

<div class="callout good">
  <p>This page is a work in progress, and Kade wants it to be genuinely useful — not generic advice. If you've found a screen-reader trick that works great here (or a spot that fights you), <strong>contact Kade</strong> so it can be added or fixed.</p>
</div>
${nextprev("donate", "troubleshooting")}
`,
};

// ---- 10. TROUBLESHOOTING --------------------------------------------------
PAGES.troubleshooting = {
  title: "When Something Breaks",
  h1: "When Something Breaks",
  tagline: "The usual hiccups and the quick fixes. Most of these take ten seconds.",
  main: `
<p class="lead">Tech has its moments. Here are the things that actually come up, and what to do about each.</p>

<h2>The voice won't auto-play</h2>
<p>On phones (especially iPhones with the site on your home screen), the browser often blocks sound from starting on its own until you've tapped the screen. <strong>Fix:</strong> tap a reply's play button once by hand — that usually unlocks audio for the rest of that session. It's a phone-browser rule, not a fault here.</p>

<h2>The voice sounds robotic / like the phone's built-in voice</h2>
<p>That's your device reading instead of the real character voices. <strong>Fix:</strong> Settings → Speech → Text to Speech → <strong>Engine → External</strong>. Do it inside the same app you chat in (if you use the home-screen app, flip it there, not in Safari), close it fully, reopen. Real voices restored.</p>

<h2>The call button plays but can't hear me</h2>
<p>The in-app phone button needs microphone permission — say yes when asked. If it's speaking over itself or acting confused, hang up with End call and tap the phone button again; a fresh call resets everything.</p>

<h2>It keeps asking for my microphone (iPhone)</h2>
<p>Apple doesn't reliably remember mic permission for home-screen web apps, so it re-asks — sometimes every time you start talking. <strong>Fix:</strong> just tap "Allow" again. There's no setting on this site that turns it off; it's an Apple limitation. Annoying, but harmless.</p>

<h2>A reply seems stuck — it's "thinking" forever</h2>
<p>Once in a while a reply stalls out behind the scenes. <strong>Fix:</strong> wait a few seconds, then if it's clearly hung, just send your message again. It almost always comes back fine on the second try.</p>

<h2>Where's my balance / how much have I used?</h2>
<p>Each message shows its cost and usage right there in the chat, so you can keep an eye on it as you go. (Curious what the numbers mean? The <a href="/help/tokens">What Are Tokens?</a> page explains them.) Remember your balance refills automatically every 30 days — see <a href="/help/costs">What This Costs Kade</a>.</p>

<h2>Pictures stopped working</h2>
<p>Image-making draws from a small separate pot of credits. If it suddenly won't make pictures, that pot may have run dry. <strong>Fix:</strong> contact Kade — she can top it up.</p>

<h2>I can't log in / I want an account for someone</h2>
<p>Accounts are set up by Kade personally (it's an invite-only place). If you're locked out or want to add a family member, <strong>contact Kade</strong>.</p>

<h2>Found a bug, or wish it did something new? Just say so.</h2>
<p>You don't have to track Kade down. Tell <em>any</em> character — Kiana, a companion, whoever you're already talking to — something like <em>"that's broken, can you report it?"</em> or <em>"I wish it could do this."</em> They'll offer to send it to Kade for you, and once you say yes it goes straight to her with your name on it so she can follow up. Works in chat and on the phone. Free, and it actually reaches her.</p>

<div class="callout warn">
  <p><strong>Still stuck after trying the above?</strong> Don't wrestle with it. <strong>Contact Kade</strong> — that's what she's there for, and "it's doing a weird thing" is a perfectly good bug report.</p>
</div>
${nextprev("accessibility", null)}
`,
};

// ---- Register a route for every page --------------------------------------
for (const key of Object.keys(PAGES)) {
  const def = PAGES[key];
  const section = SECTIONS.find((s) => s.key === key);
  const path = section ? section.path : (key === "home" ? "/help" : `/help/${key}`);
  router.get(path, (req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(page({ key, title: def.title, h1: def.h1, tagline: def.tagline, main: def.main }));
  });
}

module.exports = router;
module.exports.SECTIONS = SECTIONS;
module.exports.PAGES = PAGES;
module.exports.renderPage = page; // exported for offline render tests
