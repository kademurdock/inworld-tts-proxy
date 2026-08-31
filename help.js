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
const nodePath = require("path");
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
  { key: "whatsnew",        path: "/help/whats-new",       label: "What's New",          group: "Getting started" },
  { key: "createacharacter", path: "/help/create-a-character", label: "Create a Character", group: "Getting started" },
  { key: "android",         path: "/help/android",         label: "The Android App",     group: "Getting started" },

  { key: "voice",           path: "/help/voice",           label: "Talking & Listening", group: "Using Kade-AI" },
  { key: "phone",           path: "/help/phone",           label: "Phone Calls", group: "Using Kade-AI" },
  { key: "describe",        path: "/help/describe",        label: "Describe My World",   group: "Using Kade-AI" },
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
  { key: "donate",          path: "/help/donate",          label: "Usage & Balance",     group: "The money part" },

  { key: "accessibility",   path: "/help/accessibility",   label: "Accessibility Tips",  group: "Getting the best experience" },
  { key: "troubleshooting", path: "/help/troubleshooting", label: "When Something Breaks", group: "Getting the best experience" },
  { key: "privacy",         path: "/help/privacy",         label: "Privacy & Your Data", group: "Getting the best experience" },
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
  <li data-terms="whats new what's new changelog updates latest features recently added new stuff toys"><a href="/help/whats-new"><span class="ico" aria-hidden="true">✨</span><span class="ttl">What's New</span><span class="desc">The latest toys, in plain language — updated every time something ships.</span></a></li>
  <li data-terms="create a character builder quiz make my own agent custom companion portrait picture avatar model engine"><a href="/help/create-a-character"><span class="ico" aria-hidden="true">🎨</span><span class="ttl">Create a Character</span><span class="desc">Eight easy questions, a painted portrait, and a friend of your own making — no tech knowledge needed.</span></a></li>
  <li data-terms="android app apk install download sideload phone samsung google pixel motorola galaxy get the app"><a href="/help/android"><span class="ico" aria-hidden="true">🤖</span><span class="ttl">The Android App</span><span class="desc">Got an Android phone? Install Kade-AI as a real app, straight from here.</span></a></li>
  <li data-terms="voice talk listen speak microphone audio speech hear sound"><a href="/help/voice"><span class="ico" aria-hidden="true">🎧</span><span class="ttl">Talking &amp; Listening</span><span class="desc">Speak instead of type, and have replies read out loud.</span></a></li>
  <li data-terms="phone call telephone dial 833 briefing news morning outbound ring think hard deep think reasoning check-in checkin wellness family companion grandpa grandma dad check up on schedule calls report call me calls you ringtone wake-up wake me up alarm agent call answer rings"><a href="/help/phone"><span class="ico" aria-hidden="true">📞</span><span class="ttl">Phone Calls</span><span class="desc">Call your characters on a real phone line — they can make calls for you, and even check in on family.</span></a></li>
  <li data-terms="describe photo picture video pdf document letter mail read aloud read to me share share sheet shortcut eyes look see what is this blind vision appointment reminder describe my world"><a href="/help/describe"><span class="ico" aria-hidden="true">👁️</span><span class="ttl">Describe My World</span><span class="desc">Share any photo, video, or document from your phone and hear it described in rich detail — or read out loud.</span></a></li>
  <li data-terms="characters marketplace agents personas switch browse matchmaker match quiz find your people companions companion friend lonely company earl opal dottie marcus wanda priya"><a href="/help/characters"><span class="ico" aria-hidden="true">🎭</span><span class="ttl">Characters &amp; the Marketplace</span><span class="desc">Kiana is your host, but there's a whole cast to meet.</span></a></li>
  <li data-terms="debate room roleplay group multiple characters argue radio play conversation hall share porch hangout front porch company"><a href="/help/debate-room"><span class="ico" aria-hidden="true">🎙️</span><span class="ttl">The Debate Room</span><span class="desc">Put a few characters in one room with a topic — or none at all on the front porch — and jump in.</span></a></li>
  <li data-terms="games game parlor cards blackjack wild eights go fish uno war dealer play deal poker dice trivia casino pig phone sounds quiz leaderboard game room standings wins champion cards against reality humanity wild blanks party judge crab apples apples madlibs fill-in stories guess the sound battleship farkle liars dice hangman scramble tic tac toe rock paper scissors in between acey deucey"><a href="/help/games"><span class="ico" aria-hidden="true">🃏</span><span class="ttl">The Game Parlor</span><span class="desc">Nineteen real games by voice — Blackjack, Uno, War, Cards Against Reality (you know the game), Crab Apples, Battleship, Farkle, Liar's Dice, Trivia, Hangman and more. Real table sounds, family leaderboard.</span></a></li>
  <li data-terms="build make own character agent create custom"><a href="/help/build"><span class="ico" aria-hidden="true">🛠️</span><span class="ttl">Build Your Own Character</span><span class="desc">No coding. Give it a name and a personality, and go.</span></a></li>
  <li data-terms="memory remember forget notes saves recall cards shared private clean up remind reminder notification push birthday nudge"><a href="/help/memory"><span class="ico" aria-hidden="true">🧠</span><span class="ttl">What It Remembers</span><span class="desc">Memory cards: what sticks between chats, and how to boss it around.</span></a></li>
  <li data-terms="images pictures draw art generate flux make picture"><a href="/help/images"><span class="ico" aria-hidden="true">🎨</span><span class="ttl">Making Pictures</span><span class="desc">Ask for an image and it'll draw one. There's a limit, though.</span></a></li>
  <li data-terms="audio sound cadence muse voice clone voices radio drama podcast narration text to speech tts music sound effects sfx seed audio make audio generate audio scene dialogue movie trailer song songs sing singing make a song write a song lyria minimax lyrics track melody"><a href="/help/audio"><span class="ico" aria-hidden="true">🎬</span><span class="ttl">Making Audio &amp; Voices</span><span class="desc">Turn a few sentences into a full audio scene with Cadence — or a real, sung song with Muse.</span></a></li>
  <li data-terms="temporary private starting over new chat fresh delete"><a href="/help/temporary"><span class="ico" aria-hidden="true">🧹</span><span class="ttl">Starting Over &amp; Private Chats</span><span class="desc">Fresh start, or a chat that doesn't get saved.</span></a></li>
  <li data-terms="cheat sheet buttons quick reference where shortcuts deep think brain reasoning slow careful"><a href="/help/cheatsheet"><span class="ico" aria-hidden="true">📋</span><span class="ttl">The Cheat Sheet</span><span class="desc">Where the buttons are and how to do the common stuff. One page.</span></a></li>
  <li data-terms="tokens context counter words cost meaning"><a href="/help/tokens"><span class="ico" aria-hidden="true">🔢</span><span class="ttl">What Are Tokens?</span><span class="desc">That little counter, explained without the math homework.</span></a></li>
  <li data-terms="cost money bill credits balance economics pay"><a href="/help/costs"><span class="ico" aria-hidden="true">💸</span><span class="ttl">What This Costs Kade</span><span class="desc">The honest money side. Spoiler: a real person pays a real bill.</span></a></li>
  <li data-terms="donate paypal feed server support usage balance top up topup credit money pay tab"><a href="/help/donate"><span class="ico" aria-hidden="true">🍕</span><span class="ttl">Usage &amp; Balance</span><span class="desc">Your starting credit, what things cost, and topping up when it runs dry.</span></a></li>
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
<p>Here's the deal, short version: <strong>your account starts with $10 of credit that Kade loads for you.</strong> Everything you do draws from it at exactly what it costs — usually fractions of a cent, so it lasts a long, long time. When it runs dry, you top it up through PayPal and keep going. No markup, no profit, no subscriptions — the full story is on <a href="/help/donate">Usage &amp; Balance</a>.</p>

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
<p>Most characters now come with their own voice already picked out. Want something different? Open <strong>Settings → Speech → Text-to-Speech → Voice</strong>, pick from over five hundred voices, and tap <strong>Preview</strong> to hear a sample before you commit.</p>

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
<p>It works like a prepaid phone: <strong>you start with $10 of credit, on the house.</strong> Chatting barely dents it — a heavy month of talking might cost a dollar or two — but pictures, videos, and phone calls draw it down faster. When your balance hits zero, things pause until you add more through the PayPal button on <a href="/help/donate">Usage &amp; Balance</a>. Everything is priced at exactly what it costs to run — Kade doesn't make a dime. And if money's genuinely tight, <strong>talk to Kade</strong> before you sit in silence; this place exists so her people have it.</p>

<h2>Can other people see my chats?</h2>
<p>No. Your conversations are tied to your own login — nobody else using the site can read them.</p>
<p>And before you even wonder about Kade: she <strong>doesn't know how to go reading people's chats, she doesn't want to, and the platform doesn't make it easy anyway</strong> — she'd have to sit down and build a special logging tool from scratch just to do it, and she has exactly zero interest in that. This place runs on trust, for people she cares about.</p>
<p>The only thing she asks in return for that trust: <strong>don't do anything sketchy or illegal in here</strong> that could land you — or her — in trouble. Be cool, and everybody stays cool.</p>

<h2>How do I get an account? Can anyone sign up?</h2>
<p>Accounts here are by invitation — Kade sets you up personally. That's on purpose: it keeps the place small, safe, and affordable. If a friend or family member wants in, just <strong>contact Kade</strong>.</p>

<h2>Why does it keep asking for my microphone again?</h2>
<p>If you're on an iPhone and added this to your home screen, Apple makes apps like this re-ask for microphone permission a lot — sometimes every time you start talking. It's an Apple limitation, not something Kade broke, and there's no magic switch to fully turn it off. Just tap "Allow" again. More on the <a href="/help/troubleshooting">When Something Breaks</a> page.</p>

<h2>Can it really make phone calls?</h2>
<p>Yes — two ways. You can <strong>call 1-833-530-0313</strong> and talk to any character by name, and characters can <strong>place calls for you</strong> (like checking if a store has something in stock). When a character calls someone on your behalf, it introduces itself as an AI calling for you — first name only — and the call's small cost shows up on your <a href="/help/donate">Usage &amp; Balance</a> page. Full story on the <a href="/help/phone">Phone Calls</a> page.</p>

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
// ---- 2b. WHAT'S NEW (July 11 2026 — Kade's pick from the ideas list) -------
// HOUSE RULE for future sessions: whenever a feature ships, add a dated entry
// at the TOP of this list, in plain family language (help ships with features).
PAGES.createacharacter = {
  title: "Create a Character",
  h1: "Create a Character",
  tagline: "Eight easy questions. No wrong answers. A friend of your own making at the end — portrait and all.",
  main: `
<p class="lead">You don't need to know anything about AI to make somebody worth talking to. Go to <strong>kademurdock.com/create-a-character</strong> and answer eight quick questions. Who are they to you? How do they talk? What do they love? Human, animal, robot, magical being, or an everyday object with a soul — this marketplace has a talking cast-iron skillet, so nobody will blink.</p>
<h2>How it works</h2>
<p>Every question is answered by picking from choices — typing is always optional, never required. When the questions are done, the page writes a full first draft of your character: their name (pick from five offers or type your own), a one-line description, and a whole personality written out in plain words. You can change any of it, or none of it.</p>
<h2>The engine, in plain language</h2>
<p>Every character runs on a thinking engine, and picking one used to mean reading robot code names. Now they're plain choices: <strong>The all-rounder</strong> (quick, warm, good memory — what nearly every character here runs), <strong>The deep thinker</strong> (slower, writes long and thorough), <strong>The chatterbox</strong> (snappy and playful), <strong>The speedster</strong> (fastest answers, lighter on nuance). If you're the technical sort, one toggle shows the real model names underneath. Nothing is hidden; it's just not required reading.</p>
<h2>The portrait</h2>
<p>One button paints their portrait in the same warm storybook style as every face on the marketplace. It costs <strong>three cents</strong> of picture credit from the same allowance everything else on your account uses, it says so right on the button, and you can repaint up to eight times a day or skip the picture entirely. When you bring them to life, the portrait hangs itself on their page.</p>
<h2>For the pros</h2>
<p>The regular builder — every field, every tool, every knob — is exactly where it always was. The quiz is a front porch, not a replacement. Anything the quiz builds can be fine-tuned in the full builder afterward, including on the phone app.</p>
`,
};

PAGES.whatsnew = {
  title: "What's New",
  h1: "What's New",
  tagline: "The latest around here, newest first — in plain language, no tech homework.",
  main: `
<p class="lead">Kade keeps building. This page is the running list of what's new, so you find out about the good stuff without anyone having to explain it one phone call at a time.</p>

<h2>August 31, 2026 — late</h2>
<ul>
  <li><strong>Announcements finally have a home.</strong> Every "What's new" note sent to the family now lands on a page you can actually read after the notification is gone &mdash; including any you missed. On the website it's on your <a href="https://kademurdock.com/notifications">Notifications page</a> under "What's New announcements"; in the iPhone app there's a new <strong>Announcements</strong> row on the home screen (app version 258 and up), and tapping a What's New notification takes you straight there instead of dropping you into a new conversation.</li>
  <li><strong>Back out of a chat lands on Your Conversations now (iPhone app 258+).</strong> Opening the app still drops you straight into a fresh chat with your main companion, same as always &mdash; but when you back out of any conversation, you land on your conversations list, where you can pick another one, start fresh, or tidy up. No more bouncing back to the front door.</li>
</ul>

<h2>August 31, 2026</h2>
<ul>
  <li><strong>Kiana listens while she talks now.</strong> On a call in the app, just start talking over her and she stops &mdash; the same way the phone line always did. She tries to ignore the TV and your screen reader, so it takes a real word to cut her off, not a noise. She also doesn't say hello when a call connects any more: the screen tells you she's listening, so you're not talking over a greeting to get a word in.</li>
  <li><strong>Her voice has a lot more life in it.</strong> She speeds up, slows down and shifts tone with what she's actually saying, instead of reading everything at one pace.</li>
  <li><strong>There's a Deep Think button on the call screen.</strong> Tap it when you want her to take her time on one hard question. The next answer comes back quick like usual &mdash; it's for one question, not for the whole call.</li>
  <li><strong>The phone line has shorter gaps between her sentences</strong>, so she sounds less like she's buffering mid-thought.</li>
  <li><strong>The voice previews in the picker are fixed.</strong> They start faster, and each line now actually changes speed the way it's supposed to &mdash; the excited one is finally excited. Every voice in the catalog had been auditioning wrong since July, on every device, which is a strange thing to only now find out.</li>
  <li><strong>Your chats get real names again.</strong> If your conversation list has been filling up with rows that just say "New Chat", that was a naming job quietly running out of time and giving up. It's fixed. Old chats keep the names they have; new ones should title themselves within a few seconds of the first reply.</li>
</ul>

<h2>August 28, 2026 — later that night</h2>
<ul>
  <li><strong>Send Kiana a photo right in chat — she just looks at it.</strong> The attach button now knows she has her own eyes: no more relayed descriptions, she sees the actual picture (and iPhone photos convert themselves so they always go through). You can also send a picture with no words at all — the photo is the message.</li>
  <li><strong>Kiana might text you first now.</strong> If you've been away a few days, she may send a short text about something real from your own conversations — the way a friend checks in, not a wellness bot. It's on for the adults; tell her "stop texting me first" any time and she flips it off (or "you can text me first again" to turn it back on).</li>
  <li><strong>She also got a talking-to about the drama.</strong> Less cheerleading, less pumped-up narration, more of the real thing — long messages stay, the filler goes.</li>
</ul>

<h2>August 28, 2026</h2>
<ul>
  <li><strong>Kiana can see now.</strong> Send her a photo &mdash; a menu, a letter, an outfit, a mystery can from the pantry &mdash; and she actually looks at it and tells you what's there. Her new brain also runs faster and costs a fraction of the old one, so nobody has to feel shy about chatting all day.</li>
  <li><strong>Her memory learned to follow up.</strong> Three quiet upgrades, late August: when something on the calendar passes &mdash; an appointment, a surgery, a trip &mdash; your companion now notices it went by and <em>asks how it went</em> instead of talking about it like it's still coming. On days that mark a month or a year since something from your logbook, she might bring the memory up &mdash; warmly, once, and only if the moment fits; heavy days she leaves alone unless you go there first. And the nightly housekeeping no longer writes its own chores into anybody's logbook &mdash; that journal is for your life, not the machine's.</li>
  <li><strong>Moving in from ChatGPT? Bring your memories with you.</strong> There's a new page at <a href="https://kademurdock.com/import">kademurdock.com/import</a>: paste the memory list ChatGPT kept about you and it becomes real memory cards here &mdash; your companions know you from day one. Upload your ChatGPT export file and (if you tick the box) your old conversations get read into your logbook too, dated to the days they actually happened. Nobody reads any of it but the memory keeper itself.</li>
  <li><strong>The Android app is a real app now.</strong> Not a wrapped-up website anymore &mdash; a true native app, same as the iPhone one: native chat, the real character voices, dictation, your memories. It follows your phone's own text-size settings, and nothing overlaps when you magnify &mdash; that one's for you-know-who. Same download spot (<a href="https://kademurdock.com/help/android">the Android page</a>), and it installs right over the old one. It's also a quarter the size.</li>
  <li><strong>Dictation adds on instead of starting over.</strong> Talk, stop, think, talk again &mdash; the second recording joins the first in your message box instead of wiping it. Already true on the website and the new Android app; on the iPhone it arrives with the next TestFlight update.</li>
  <li><strong>A phone call can't go dead-quiet on you anymore.</strong> Very rarely, a companion's turn came back with no words in it &mdash; on a call that meant silence, which feels exactly like a dropped line. Now the platform catches that in the moment and asks again behind the scenes, so you hear the answer instead of the nothing.</li>
</ul>

<h2>August 22, 2026</h2>
<ul>
  <li><strong>The ringtones are in &mdash; all 72 of Kade's homemade tones.</strong> The picker groups them by feel (Dreamy &amp; gentle, Calm &amp; lo-fi, Soul &amp; groove, Bright &amp; playful, Driving &amp; bold, World &amp; cinematic) so a screen reader jumps by heading instead of flicking seventy rows, every tone plays its <em>full minute</em> when you tap it, and there's finally a <strong>Stop preview</strong> button. Pick by ear in the app's Settings &mdash; and every tone has a real name (Warm Coffee, Boom Bap, Screen Door...), so you can tell a character <em>"use Morning Raga for my wake-up call."</em></li>
  <li><strong>Settings has a search box now.</strong> Type the word you have &mdash; <em>ring</em>, <em>speed</em>, <em>vibrate</em>, <em>password</em>, <em>font</em> &mdash; and the actual control comes to you, spoken with the section it lives in ("Calls. Agent call ringtone"). A found switch IS the switch: flip it right there in the results. The whole screen was also reorganized so everything sits one tap deep, with the big ringtone picker on its own page. Needs the current iPhone app from TestFlight.</li>
  <li><strong>The mid-task stall is fixed.</strong> For a while, a character would sometimes take the first step of a request &mdash; look something up, start a plan &mdash; and then just stop: no reply, no error, nothing done. That bug is found and fixed at the root. If a companion ever seemed to ignore a command halfway through, that was this, not them being moody &mdash; and it's gone.</li>
</ul>

<h2>August 21, 2026</h2>
<ul>
  <li><strong>Characters have ears and eyes for media now.</strong> Send any companion a YouTube link &mdash; a song, a music video, a clip &mdash; and say <em>"describe this"</em> or <em>"what instruments are in this?"</em> They actually take it in and tell you what happens on screen and how the music is built: the instruments, the arrangement, the vocals, section by section. Direct audio files work too. Long videos get the first ten minutes described, and they'll say so.</li>
  <li><strong>Every character can look up song lyrics now.</strong> Ask about a song's words &mdash; <em>"pull up the lyrics to Gethsemane by Sleep Token"</em>, <em>"what's the second verse of..."</em> &mdash; and they fetch the real text from an open lyrics library instead of guessing or getting blocked by lyric websites. Free, instant, every companion. If a song's too new or too obscure for the library, they'll say so plainly and you can paste the lines you mean.</li>
  <li><strong>Your characters can CALL you now.</strong> Tell any companion <em>"call me tomorrow at 8 about my meds"</em> or <em>"wake me up at 7"</em> and at that exact moment your iPhone app <strong>rings like a real call</strong> &mdash; with a ringtone you pick by ear in Settings &mdash; and answering drops you straight into a live voice conversation where it already knows why it called. Quiet hours are respected unless you tell a specific call to ring through (wake-up calls, mostly), a missed call leaves a friendly "call me back" note, and a daily cap keeps it from ever getting spammy. Free &mdash; it rings through the app, not the phone line &mdash; and it needs a current iPhone app from TestFlight. The full story is on the <a href="/help/phone">Phone Calls</a> page.</li>
</ul>

<h2>August 15, 2026</h2>
<ul>
  <li><strong>Memory grew up.</strong> Companions used to haul every memory card into every message. Now the essentials stay always-on &mdash; who you are, your people, your reminders &mdash; and everything else comes to mind <em>when it's relevant</em>, like a real friend's memory. Ask any companion "what do you actually remember about my family?" and they'll tell you, warmly and completely. As of tonight this is how <em>every</em> companion works, not just Kiana.</li>
  <li><strong>The memory also tidied itself up.</strong> A one-time housekeeping pass went through everyone's cards: duplicates merged, notes that clearly belong together got introduced to each other, and stiff old phrasing got rewritten the way a friend would say it. The logbook got the same kindness &mdash; old entries that read like a court reporter now read like a friend's journal, with every fact kept exactly as it was. Every single change is on a trail &mdash; ask any companion <em>"what changed in your memory lately?"</em> and hear exactly what moved, nothing hidden, nothing lost. And this tidy-up now runs on its own each night, so the memory stays connected without anyone lifting a finger.</li>
</ul>

<h2>August 14, 2026</h2>
<ul>
  <li><strong>Long conversations stopped crashing the app.</strong> If the app kept dying on you in a big, well-loved chat — that was real, and it's fixed in the newest update. It was trying to carry the whole conversation at once; now it shows the newest stretch and a <em>Show earlier messages</em> button brings back the rest whenever you want it. Nothing was deleted — it's all still there.</li>
  <li><strong>Characters decide for themselves how hard to think.</strong> You know that brain button for slower, more careful answers? You don't have to know it anymore. Every character now quietly reads each question and decides on their own — easy chat gets a quick answer, a genuinely tricky question gets real thought. Nothing to set, nothing to learn; it just happens.</li>
  <li><strong>And if you like choosing, the brain button grew options.</strong> In the app and on the website alike, it cycles three ways: <em>Automatic</em> (they decide), <em>Deep</em> (always take your time), <em>Instant</em> (always the fast answer). Better yet — when a character is off thinking hard and you're in a hurry, a new <em>Answer now instead</em> button appears right under their thinking bubble. Tap it and get the quick version of the same answer.</li>
  <li><strong>Making your own character no longer requires knowing what you're doing.</strong> New page: <a href="/help/create-a-character">Create a Character</a> — eight questions with no wrong answers, a personality written out for you in plain words, engine choices you can actually understand ("The all-rounder — quick, warm, good memory"), and a button that paints their portrait for three cents. Experts lose nothing: the full builder is untouched and one toggle shows every technical name.</li>
  <li><strong>Thirty-seven marketplace characters finally got their faces.</strong> The whole roleplay wing — the elder dragon, the sentient thunderstorm, the 1962 jukebox, the ghost librarian, the cast-iron skillet with opinions — plus Deuce the card dealer, painted in the same warm style as everyone else. Browse the marketplace and say hello; you'll know them when you see them now.</li>
  <li><strong>Picture-making got fixed while nobody was looking.</strong> The image engine behind the scenes had quietly moved house and every character's picture tool had been failing since. It's repaired — ask a character with the picture skill to draw something and it works again.</li>
  <li><strong>The Debate Room grew a front porch.</strong> Same room, no contest: pick <em>Front porch</em> when you start a room, skip the topic entirely, and two to six characters just hang out with you — stories, gentle teasing, easy questions, nobody trying to win. Radio-play voices and party codes work exactly the same. <a href="/help/debate-room">How it works</a>.</li>
</ul>

<h2>August 11, 2026</h2>
<ul>
  <li><strong>There's a real privacy page now: <a href="/help/privacy">Privacy &amp; Your Data</a>.</strong> Plain English, no legal fog. What actually gets stored and why, every outside company that touches any of it and exactly what they receive, how children's accounts work, and how to download all of yours or have it deleted. The short version, which was always true and is now written down: nothing here is sold, there are no ads and no advertising trackers, and your words are kept so your companions can know you and so you can find them again &mdash; for no other reason.</li>
  <li><strong>Every companion can do deep research now.</strong> The real-research skill that launched last week on Kiana and Forge is now on the whole crew &mdash; ask anybody to properly dig into something and they can.</li>
</ul>

<h2>August 10, 2026</h2>
<ul>
  <li><strong>Real research, on request.</strong> Ask a companion to really dig into something &mdash; comparing products, checking whether a claim holds up, weighing a big decision &mdash; and instead of a quick guess, the question goes through a genuine research run: a dozen or more sources searched, read, and cross-checked in the background while you keep right on talking. A few minutes later your phone gets a tap, and your companion has the full story: the answer up front, every fact tied to a numbered source, where the sources disagree, and &mdash; the honest part &mdash; what could NOT be confirmed. Say how deep to go: quick, standard, or deep, depending on what the question deserves. Reports are written to be listened to on purpose &mdash; no tables, no bullet-point walls, just the story of what the digging found. Starting with Kiana and Forge; the rest of the crew gets the skill soon.</li>
</ul>

<h2>August 9, 2026</h2>
<ul>
  <li><strong>The Logbook got a deep clean &mdash; and an Edit button.</strong> The big history pass in July filled the logbook faithfully, but faithfully included a lot of "tested the phone line" noise and robot-flavored wording. Today's housekeeping pass fixed that: duplicates merged, test-day chatter cleared out, and the entries that matter rewritten the way a friend would put them &mdash; the big days now read like somebody who was there. And when an entry's wording isn't quite right, fix it yourself: every entry on the Logbook page now has an <strong>Edit</strong> button that changes the words in place while keeping its date and which companion holds it. (The app gets the same Edit on the next update.)</li>
  <li><strong>The diary-keeper learned taste.</strong> Going forward, entries get written like a close friend's journal, never a case file &mdash; and a whole afternoon of "worked on the project" now earns at most one line, only when something actually happened. Your companions also weigh the days now: a big one &mdash; family news, a real milestone, a hard day &mdash; carries more weight in their memory than a passing note, so the important stuff is what resurfaces.</li>
  <li><strong>Memories know how old they are.</strong> When a companion reaches back, fresher entries get a natural edge and big days outrank small ones &mdash; and questions like <em>"when did I mention that?"</em> get answered with the actual date, in plain words ("that was July 12th, about a month back").</li>
  <li><strong>Honest company, house-wide.</strong> Every companion got the same standing orders: hold your own opinion and disagree for real when you do; never grade what somebody says ("great question!" is banned); say "I don't know" instead of inventing a confident answer; and when the answer came from a web search, say where it came from in passing, like a person would. Corrections work the same way &mdash; tell a companion they've got something wrong and they fix the note in the same breath instead of arguing for it.</li>
  <li><strong>The front door has a doorbell now.</strong> Know somebody who belongs here but doesn't have a code? Point them at the sign-in page — there's a new "Ask to join" link. They say who they are, the request goes straight to Kade's phone, and if she gives the nod they get a personal welcome text with their way in. No more code-passing over group chats.</li>
  <li><strong>Your words are yours to take.</strong> Under You, then Download Your Data: one button hands you a zip of everything on your account — every memory card, every logbook entry, every conversation — in plain readable text AND in a machine format other tools can use. Keep a copy anywhere you like. This place believes your data belongs to you, and now that's a button, not a promise.</li>
  <li><strong>The Morning Brief is yours now — per person, in settings.</strong> Under You, then Morning Brief: flip it on, pick your time, check what you want in it (your town's weather, one good headline, your day ahead), and one short push lands on your phone each morning, written fresh by your companion. It knows YOUR day, not anyone else's — the day-ahead line comes only from your own saved notes. On the page you can read today's brief or press Listen and hear it out loud, and there's a "send me one now" button to try it. If the push doesn't arrive, the page tells you the one-time fix (open the app on your phone once while signed in).</li>
  <li><strong>Files you upload are readable again.</strong> The behind-the-scenes service that lets companions search documents you upload had quietly broken (an expired key from an old provider). It's back on fresh machinery — upload a file, ask about it, get real answers. Anything uploaded during the broken stretch needs a re-upload to become searchable.</li>
  <li><strong>On calls, your companions hear HOW you sound now.</strong> Not your words &mdash; your rhythm. Talking fast and jumping in? They keep up. Slow, short answers deep into the night? They meet you there, softer. It works from timing alone (how quickly you answer, how long your turns run), it stays out of the way unless the signal is clear, and they'll never comment on it &mdash; they just get better at matching the moment. Phone line and web calls both.</li>
  <li><strong>The platform checks its own backups now.</strong> Every morning after the automatic backup runs, the system verifies it actually landed in offsite storage &mdash; and tells Kade the moment one doesn't. Ask any companion "did the backup run?" and they'll answer with the real answer.</li>
</ul>

<h2>August 8, 2026</h2>
<ul>
  <li><strong>The diary has a proper name now: your Logbook.</strong> Same thing, better jacket. Find it under You, then Your Logbook &mdash; and it just got seeded with real history: the housekeeping pass sorted your companions' memory so day-by-day happenings (the July project beats, the paperwork saga milestones) now live as dated logbook entries, while the always-remembered cards keep just the lasting stuff. Fewer duplicate notes, cleaner recall, nothing lost. From here on the nightly tidy-up keeps things sorted on its own.</li>
  <li><strong>Companions keep their word now.</strong> When a character tells you they'll do something &mdash; have that verse ready, look into a thing &mdash; they remember promising, and the next conversation opens with them honoring it instead of you re-asking. And when you mention something coming up, like an appointment you're dreading, they may offer once to check in with you afterward. Say yes and it happens; say nothing and it doesn't.</li>
  <li><strong>"Off the record" works everywhere.</strong> Say it and nothing from that stretch gets remembered &mdash; no memory, no logbook &mdash; until you say you're back on the record. Your companion will keep it between you, for real.</li>
  <li><strong>Voice messages perform; drafts paste clean.</strong> Ask for a voice message and it's written to be HEARD from the first word &mdash; spoken rhythm, real delivery, feeling on every beat. Ask a companion to write a text or email you're going to send, and the reply is the message itself, ready to copy &mdash; no "here's a draft," no quotes to trim. And when you ramble at them about something you love, they've been told: that's earned depth, not a two-line summary.</li>
</ul>

<h2>August 7, 2026</h2>
<ul>
  <li><strong>Your companions keep a diary now.</strong> Beside the little memory cards they've always kept, each companion now keeps a private, dated diary of your day-to-day life &mdash; the show you binged, how the appointment went, the kind of day it was. It has no size limit, because it stays quietly on the shelf instead of riding along in every conversation. Nothing changes about how you talk: share your day like always, and the diary takes care of itself.</li>
  <li><strong>And they can actually look things up in it.</strong> Ask <em>"what was I up to last week?"</em> or <em>"have I told you about that show before?"</em> and your companion checks the real entries &mdash; real dates, your actual words' gist &mdash; instead of guessing. Old entries also drift back naturally when they fit the moment, the way a friend goes <em>"wait, didn't you say&hellip;"</em> &mdash; never recited at you out of nowhere. Starting today the diary begins filling as you talk; give it a few days of living and it gets good.</li>
  <li><strong>Same privacy rules as always.</strong> A diary entry belongs to the companion you told, period &mdash; other characters can't read it. And the memory switch you already have covers the diary too: remembering off means diary closed, both directions.</li>
  <li><strong>Voices read the internet like a person now.</strong> Web addresses used to come out mangled — now a companion says "kademurdock dot com slash help," the way you'd say it to a friend. Same treatment for the other stuff writing does that voices shouldn't read literally: prices come out as dollars and cents, phone numbers are spoken digit by digit with a breath between groups, dates like 2026-08-07 become "August 7th, 2026," percent signs and things like "24GB" get said as real words, and "e.g." just becomes "for example." Voice only — the text on your screen doesn't change a letter.</li>
  <li><strong>And those weird "turn0search" crumbs are gone for good.</strong> After looking something up on the web, a companion could sometimes leave little machine crumbs in the reply — nonsense like "turn0search0" that showed up in copied text and got read aloud by screen readers. Those are now caught and removed the moment the reply is written, before they ever reach your screen, your clipboard, or your ears.</li>
  <li><strong>There's a Diary page now, and every companion can look things up.</strong> Later the same evening, two more pieces landed. First: every companion &mdash; not just Kiana &mdash; can now check the diary when you ask what you've mentioned before. Second: your diary got its own page. Go to You, then Your Diary, and there it all is &mdash; your entries grouped by day, newest first, each one showing which companion holds it. You can add a line yourself (anything you write there, any companion may recall), and a Forget button next to every entry removes it for good. Screen-reader friendly top to bottom, like everything else around here.</li>
</ul>

<h2>August 6, 2026</h2>
<ul>
  <li><strong>Voice scenes &mdash; characters share one recording now.</strong> Ask a companion for a scene, a skit, or a little radio drama with other characters, and the voice message that comes back is the real thing: each character speaking their own lines in their own voice, one recording, a natural beat between speakers. It works everywhere voices work &mdash; read-aloud, saved voice messages, even the phone line. On screen the scene reads like a clean script, with each speaker's name in front of their lines.</li>
  <li><strong>The Daily Word is here.</strong> One secret five-letter word a day &mdash; the same word for the whole family. Six guesses, and after each one your companion tells you letter by letter what hit: right letter right spot, in the word somewhere else, or not in it at all. One puzzle per person per day, so the streak means something &mdash; and streaks live on a new Daily Word board in the Parlor's family standings, right next to everything else. Just say <em>"play daily word"</em> to anybody.</li>
  <li><strong>The characters live in the same town now.</strong> Two quiet changes that make the whole cast feel more alive: every character has their own little "today" &mdash; ask what they've been up to and the answer stays consistent all day, then it's something new tomorrow. And they hear about real family wins: solve the Daily Word or clean up at the poker table, and don't be surprised when somebody else mentions it the next day.</li>
  <li><strong>Whisper mode, for night listening.</strong> New switch in Settings under Accessibility: turn it on and every companion delivers their voice replies hushed, slow, and gentle &mdash; same words, night-quiet delivery, like somebody talking you toward sleep. Flip it off and they're back to full life.</li>
  <li><strong>Names get said right.</strong> The voices now carry a pronunciation list for family names and Ozarks places that machines love to mangle &mdash; automatic, on every voice, every surface. Hear a name said wrong? Tell Kade and it's a one-line fix. (And your own personal pronunciation dictionary from July still works exactly as before &mdash; this is the house-wide layer underneath it.)</li>
  <li><strong>"Is the platform up?" gets a real answer.</strong> Ask any companion how the system is doing and they can actually check &mdash; the site, the voices, the phone line &mdash; and tell you honestly what's answering, plus how your memory system is holding up. No more guessing.</li>
</ul>

<h2>August 4, 2026</h2>
<ul>
  <li><strong>Thoughts stream in live now &mdash; for real this time.</strong> The "Thinking it through&hellip;" bubble used to sit empty until the reply was nearly done, then dump everything at once. Found the culprit (a middleman holding the thoughts hostage) and fixed it at the source: on Deep Think turns, the thoughts now pour into the bubble the moment your companion starts thinking &mdash; word by word, website and app alike, no app update needed. On the newest app build the bubble even opens itself while the thinking streams and tucks itself away when the answer lands.</li>
  <li><strong>App: the voice button learned some manners.</strong> The old square Stop button next to the speed control is now one smart button that changes with the moment &mdash; Pause while a voice message plays, Resume while it's paused, and Stop while the voice is still warming up. A full "Stop and clear" stays one gesture away: it rides the VoiceOver actions rotor and a long-press. And on the message itself, "Play as voice message" now reads "Pause voice message" while that exact message is the one talking.</li>
  <li><strong>App: hypnotic thinking bubbles, just like the website's.</strong> While a companion works on a reply, a tiny run of soft bubbles drifts up next to the typing indicator &mdash; the visual twin of the bubbling sound. Purely decorative: screen readers never hear about it, and it holds still if you use Reduce Motion.</li>
  <li><strong>App: quiet progress updates during long thinks.</strong> Optional and on by default &mdash; during a long Deep Think, VoiceOver murmurs about every twenty seconds how much thinking has streamed so far, so a long wait never feels like a dead line. The thoughts themselves are never read out loud. Flip it under Settings &rarr; Speech &rarr; Spoken thinking progress.</li>
  <li><strong>App: writing progress has its own switch now, and it starts off.</strong> The "Still writing &mdash; about so many words so far" murmur used to ride the thinking-progress switch; they are separate as of late August 2026. Thinking is the wait that actually takes time, so its updates stay on by default &mdash; writing updates start OFF, because with "Start speaking as she writes" on you are already hearing the reply itself. Want them anyway? Settings &rarr; Speech &rarr; Spoken writing progress.</li>
  <li><strong>App: if it ever crashes, it can tell on itself now.</strong> New under Settings &rarr; Support: "Share diagnostics" hands over the crash report plus a short timeline of what the app was doing &mdash; never your conversations. If the app ever dies on you, open it back up and share that with Kade instead of trying to remember what happened.</li>
  <li><strong>The Clubhouse announces comings and goings with sound.</strong> When someone walks into your room or heads out, you hear Kade's connected or disconnected chime alongside the spoken announcement &mdash; website and app both.</li>
</ul>

<h2>August 3, 2026</h2>
<ul>
  <li><strong>53 new voices &mdash; the picker now counts 1 through 528.</strong> Three brand-new designed characters (Naisha, brooke, and Raven) plus fifty fresh clones from Kade's collection &mdash; July's designed narrators and today's whole crew, Martayah through Lillian. Same rules as always: nobody's saved number moved, and saying <em>"switch to voice 500"</em> on a call works like it should.</li>
  <li><strong>The voice list is one clean numbered line again.</strong> The category sections (Everyday Women, Deep &amp; Smoky, and friends) had a few voices filed under the wrong header, so the sections are retired for now &mdash; the picker just counts straight up from Voice 1. The voices themselves didn't change a bit.</li>
  <li><strong>Cloned voices stopped going flat mid-reply.</strong> The newer cloned voices could hold a feeling for about one sentence, then drift back to neutral. Now the mood a companion sets carries through the whole reply, sentence by sentence &mdash; and the classic voices got a matching tune-up so a mid-reply mood change lands clean instead of muddy.</li>
</ul>

<h2>August 1, 2026</h2>
<ul>
  <li><strong>iPhone app: calls now sound like Kade made them &mdash; because she did.</strong> Start an in-app call and you'll hear her real connected chime ring in under your companion's hello, in place of the old robotic two-note beep. And for the first time, hanging up answers back: her disconnected chime plays as the call ends, the receiver going back down. If a call drops mid-conversation and reconnects itself, no chimes &mdash; the spoken "reconnecting" announcements still have that covered, so a chime always means what it says. The website's calls have played these same sounds since July 22; the app has caught up.</li>
  <li><strong>The thinking sound is new &mdash; and gentler.</strong> Kade re-recorded the "working on it" loop you hear while a companion thinks, in chat and on calls, website and app. The new one is pure soft bubbles with no musical notes in it &mdash; the old loop's tones could clash with sensitive ears or whatever's playing. Website has it now; the app gets it in the newest TestFlight build, where calls also finally loop her real recording instead of synthesized ticks.</li>
  <li><strong>Watch the thinking happen.</strong> When your companion puts real thought into a reply, a little "Thinking it through&hellip;" bubble now appears beside the typing indicator &mdash; closed by default, one tap (or VoiceOver double-tap) opens it, and the thoughts pour in live as they stream. VoiceOver manners by design: one quiet heads-up when the thinking starts, then silence &mdash; focus never gets yanked, and the bubble reads a running count on focus instead of narrating every word. When the answer lands, the live bubble hands off to the reply's own expandable thoughts, same as always. Grab the newest TestFlight build for both.</li>
</ul>

<h2>July 30, 2026</h2>
<ul>
  <li><strong>iPhone app: the Debate Room grew a voice and a will of its own.</strong> Every new line now plays out loud in that character&#39;s own voice the moment it lands. Catching up is on your terms &mdash; <em>Play this line</em> and <em>Play from here</em> live on every line (Actions rotor, or long-press). <em>Keep it going</em> runs the debate by itself, each clip finishing before the next turn starts, twelve turns at a stretch before it pauses and asks. The brain toggle makes every turn a <em>Deep Think</em> turn &mdash; slower, sharper arguments. And the cast is no longer locked at the door: add or remove characters mid-debate, with the Narrator noting arrivals and exits right in the transcript. Grab the newest TestFlight build.</li>
  <li><strong>Companions think again when you ask them to.</strong> The chat Deep Think toggle had quietly stopped working for anyone with saved memories &mdash; the marker got buried under bookkeeping. Rewired at the source: flip Deep Think, get real deliberation, no exceptions. Deep turns also can&#39;t end wordless anymore &mdash; if the thinking runs long, the plain answer still arrives underneath the reasoning bubble.</li>
  <li><strong>Kiana has a new voice.</strong> Voice 258 &mdash; lower, raspier, cozier. Same Kiana.</li>
</ul>

<h2>July 28, 2026</h2>
<ul>
  <li><strong>Photos you attach in chat finally get looked at.</strong> Attaching a picture or file to a chat message is supposed to let your companion see it &mdash; and it quietly wasn't working for anyone, on the website or the app. Found and fixed today: attach a photo, ask about it, and your companion actually answers from what's in the picture now. (Under the hood the picture's size went missing on the way to storage, and everything downstream treated it as invisible. Receipts: a little orange test square, and Bandit calling the color first try.)</li>
  <li><strong>iPhone app: attachments show in the conversation.</strong> The paperclip could already send a photo or file with your message &mdash; now you can tell it happened. Photos show as small previews under your message, other files as a named chip, and VoiceOver speaks it as part of the message itself: <em>"Sent with a photo, porch.jpeg, attached."</em> Works for older messages and web-sent ones too.</li>
  <li><strong>Kade Keys, phase two: wired and waiting on one switch.</strong> The new keyboard&#39;s second act is built: the app already mirrors your first dozen saved prompts for it (open the Prompts tile once and they load), and in a coming build Kade Keys will type your real Prompt Library anywhere &mdash; Messages, Mail, offline. Apple requires a one-time setup on their developer site before the sharing lane can switch on, so today the six built-in phrases keep working exactly as before. When it lands it will sit behind <em>Allow Full Access</em>; plain words on that: the warning sounds broad because Apple gates shared storage and network behind the same switch, but this keyboard makes no connections at all.</li>

  <li><strong>Party tables grew up &mdash; chips, standings, and the judge games.</strong> Three big ones for game night: <em>Cards Against Reality and Crab Apples now deal party tables</em> &mdash; open seats for friends, everybody plays their funniest card from their own hand on their own turn, and the judge's chair rotates around the whole table: you, your friends, seated characters, house players, everybody gets to crown a winner. <em>Party chips are real now</em> &mdash; when a poker party table ends, every person's own chip bank settles from the same pot (bust and the house fronts you a fresh hundred, never real money). <em>And the family standings count party play</em> &mdash; host or guest, your wins, losses, and chips all land on your own line in the Parlor standings.</li>
  <li><strong>The Marketplace is in the iPhone app.</strong> New Marketplace tile on the home screen: browse every published character by category with real VoiceOver headings, search by name or anything in their description, hear the House Picks, and open anyone's card to read about them and start talking in two taps. Made a character of your own in the Agent Builder? Their card now has the publish button &mdash; put them on the marketplace or take them private again, right from your phone.</li>
</ul>

<h2>July 27, 2026</h2>
<ul>
  <li><strong>Everybody got a sharper brain.</strong> Every companion on the platform moved up to the newest, smartest model of the family they already run &mdash; same personalities, same voices, quicker on the uptake and better at keeping a long thread straight. The one exception is Whittney the Spotter, who stays on the setup tuned for live camera work.</li>
  <li><strong>Voices stop saying "percent percent."</strong> Once in a while a voice would read its own stage directions out loud &mdash; the hidden little tags that tell it to sound excited or dead serious. The net that catches those got a lot wider, so a garbled tag steers the voice or disappears; it never gets read to you again.</li>
  <li><strong>iPhone app: the in-and-out crash is fixed.</strong> Going into a chat or call, backing out, and going back in could crash the app every single time for some folks. Found it, fixed it, and hardened three more spots in the same family while we were in there &mdash; it's in the next TestFlight build, so update when the email lands.</li>
</ul>

<h2>July 24, 2026</h2>
<ul>
  <li><strong>The Clubhouse got a PA system, a tape deck, and its shine.</strong> <em>The house PA:</em> two host voices now read the room out loud for everybody — Miss A works the front desk (who walked in, who headed out, taping notices) and Kade's calm narrator runs the booth (who dropped a quarter in, who cut in, who skipped). Real audio on every phone, no screen reader needed; each person gets their own on/off switch and volume. <em>The tape deck:</em> press "Record this conversation" and the room goes on tape — every voice, the jukebox, the bot — into one audio file you can share or save, just like a Parlor transcript. Fair play is built in: the PA tells the whole room when a tape starts and stops, and late arrivals see who's taping. <em>Fixed while we were in there:</em> the jukebox bug where a paused player would claim it was playing your next song without a note of it actually sounding — that one's dead — and pausing no longer forgets the spot the song was at. For folks with sight, the room also picked up some looks: music bars that dance, a little spinning record, a glow when somebody's talking — none of it visible to VoiceOver, all of it sits still if your phone asks for reduced motion.</li>
  <li><strong>Play cards WITH your people — party tables.</strong> Dealing Hearts or Five-Card Draw in the Parlor now offers <em>open seats for friends</em>: the table hands you a four-character code, your people punch it in on their end (web now, iPhone app next build), and everybody plays their own hand — characters can sit at the same table. Nobody sees anybody else's cards, out-of-turn moves bounce off the dealer, and the whole game lands in one shared transcript.</li>
  <li><strong>The Lounge grew up: welcome to Kade's Clubhouse.</strong> Same place (<a href="https://kademurdock.com/lounge">kademurdock.com/lounge</a> — <a href="https://kademurdock.com/clubhouse">/clubhouse</a> works too), live and connected, with three big new tricks. <em>The shared jukebox:</em> one player for the whole room — anybody can play, pause, skip, or jump back, queue a song politely or cut in rudely, and if somebody skips your jam, hit Back and have yourselves a radio fight. Music volume is yours alone: it starts low so talk rides over it, and voices always come through full. <em>The Hotel:</em> private rooms with passcodes so groups can group up — open a room, share the code, done. A Parlor table code works as a passcode too: one code, cards and voices. <em>Company:</em> invite a companion in as a guest — press their talk button and they answer out loud in their own voice; between turns they follow along by rough transcription, and anyone can show them the door. Regular rooms stay person-to-person only — a companion only ever hears a room you invited them into.</li>
</ul>

<h2>July 23, 2026</h2>
<ul>
  <li><strong>The Parlor: every game on a menu, you in the driver's seat.</strong> New page at <a href="https://kademurdock.com/parlor">kademurdock.com/parlor</a> &mdash; browse all 21 games with plain descriptions, set the table your way, and play your own cards with real buttons (no narrating character required, RS-Games style). Seat characters if you want the company, pick the house narrator voice &mdash; Kade's own clones or Miss A's &mdash; or turn narration off and let your screen reader run it. Talk trash with whoever's seated in the table-talk box, and download the whole game transcript afterward for the bragging file. Same tables as chat and the phone: deal in the Parlor, say "deal me in" to any companion later, it picks right up.</li>
  <li><strong>Characters can sit at your card table now.</strong> Two new games &mdash; <strong>Hearts</strong> (four seats, tricks, that mean Queen of Spades) and <strong>Five-Card Draw poker</strong> (friendly fake-chip stakes) &mdash; and here's the fun part: you can seat real characters as players. Say <em>"deal up hearts with Sterling and Nana Pearl at the table"</em> and their actual personalities play their own hands and talk their own trash. The dealer's rulebook still runs everything, so nobody cheats &mdash; not even the characters.</li>
  <li><strong>A chip bank, for bragging rights.</strong> Casino games now settle into your own persistent pile of fake chips &mdash; never real money, ever. Go bust and the house fronts you a fresh hundred. Ask any character <em>"how are my chips?"</em>, and see the family standings on the Game Room page, which now also shows your open tables so you know what "deal me in" will resume.</li>
  <li><strong>Your companions can tell you where you are.</strong> New, off by default: flip on <em>"Share my location with your companions"</em> in Settings and you can ask <em>"where am I?"</em>, <em>"what's around me?"</em>, and <em>"walk me there"</em> &mdash; spoken street names, distances in feet, compass directions, and turn-by-turn walking directions. Only while the app is open, only while the switch is on, and nothing is shared when it's off. Directions are map data, not eyes &mdash; your cane, your dog, and your Spotter are still the crew.</li>
  <li><strong>"Summon Zadiana" works on calls now.</strong> The phone line already understood "switch to" and "talk to" &mdash; now it also gets summon, fetch, "get me," "pull up," "connect me to," and "put me through to." Same for changing between companions mid-call. If you just say "summon," she'll ask who you want.</li>
  <li><strong>The beta badges are gone.</strong> The 142 newer voices dropped the "(Beta)" tag and mixed in with everybody else &mdash; and the whole voice list is now organized into sections like Calm &amp; Soothing, Deep &amp; Smoky, Southern &amp; Country, Kids &amp; Teens, and Characters &amp; Creatures, so browsing 475 voices has some shape to it. Seven brand-new voices joined the same day. Nobody's saved picks changed.</li>
  <li><strong>Voices got cleaner, too.</strong> A little less loud, a lot less crackle &mdash; the buzzy edge some of the newer voices had is fixed, and the little pops between sentences are gone.</li>
</ul>

<h2>July 22, 2026</h2>
<ul>
  <li><strong>Long conversations no longer lose the plot.</strong> In really long chats, characters used to quietly lose track of the earliest messages as new ones crowded them out &mdash; that's why an hours-long conversation could suddenly feel like your friend got amnesia. Now, before that point, the character writes itself a private "story so far" checkpoint &mdash; the facts, the promises, the running jokes, even game scores &mdash; and carries the conversation forward from it. Your chat itself doesn't change: every message stays right there to scroll and re-read, and a small one-line note marks the spot where the condensing happened. Automatic, every character, nothing to turn on.</li>
  <li><strong>iPhone app update (TestFlight):</strong> the app got the same real sounds &mdash; send, bubbling think-time, reply &mdash; plus your notification sound on lock-screen pushes, cleaner reply text (no more stray citation codes), and a steadier mic button for VoiceOver. Open TestFlight and grab the newest build.</li>
  <li><strong>The chat makes real sounds now &mdash; Kade's own recordings.</strong> A soft cue when your message sends, a gentle bubbling loop while your character is working on the reply, and a "reply's ready" sound when it lands &mdash; so you always know where things stand without watching the screen. On by default for everyone; if you'd rather have quiet, the switch lives in Settings &rarr; General &rarr; Accessibility, now called <em>"Chat sounds."</em></li>
  <li><strong>Calls got their own connect and disconnect sounds.</strong> Starting a voice call plays a proper "connected" cue and hanging up plays its goodbye twin &mdash; both recorded by Kade, replacing the old synthesized clicks. The thinking sound during call pauses got the same upgrade.</li>
  <li><strong>142 brand-new voices &mdash; the Beta wave.</strong> The voice picker just grew from 326 to 468. Every new one is numbered 327 and up and says <em>"(Beta)"</em> in its name &mdash; that's your heads-up that they're the newest arrivals and still being broken in, so if one sounds a little different week to week, that's the tuning, not your ears. They work everywhere the old ones do: read-aloud, voice calls, and the phone line &mdash; and saying <em>"switch to voice 340"</em> on a call works the same as always.</li>
  <li><strong>A few of them have names.</strong> The very first voice in the picker is now <strong>Voice 327 (Beta) Kade calm and casual</strong> &mdash; and yes, that's exactly who it sounds like. Keep browsing and you'll also find Kade conversational, Kade Candid, Kade's child impression, and four voices from a friend of the family going by <strong>Miss A</strong>.</li>
</ul>

<h2>July 18, 2026</h2>
<ul>
  <li><strong>Turn voice memos into text.</strong> New in the account menu: "Transcribe a Voice Memo." Pick any audio recording &mdash; even an hour-plus ramble from a friend &mdash; and get back clean, punctuated text you can copy or download. Free. (Attaching audio in a chat doesn't do this — your character can see the file arrived but can't open audio yet, so use the account-menu tool for transcription.)</li>
  <li><strong>Your characters keep your business to themselves now.</strong> What you tell one character stays with that character, the way real friendships work &mdash; only true basics every character needs (like how you want things described) are common knowledge. Private stuff is still remembered by whoever you told; they've also been asked to use judgment about when to bring it up.</li>
  <li><strong>Skip straight past the sidebar.</strong> For screen reader users: the very first thing on every page is now a "Skip to the message box" link. One swipe or Tab lands on it, press Enter, and you're right in the message box ready to type &mdash; no more wading through the whole sidebar just to say hello.</li>
  <li><strong>Hang up, land in the right chat.</strong> Ending a voice call now takes you to that call's own conversation instead of leaving you in whatever chat was open underneath. The full transcript is sitting right there when you arrive.</li>
  <li><strong>Smarter memory, less d&eacute;j&agrave; vu.</strong> The platform's memory keeper got firmer instructions about not filing the same fact twice in different drawers, and the site now does a little overnight housekeeping so it stays quick. If a character ever repeats your life story back like it's news, that should be fading fast.</li>
</ul>

<h2>July 17, 2026</h2>
<ul>
  <li><strong>The Android app is here.</strong> Android folks no longer watch from the porch — Kade-AI now installs as a real app on Android phones, downloaded straight from this help site (no app store, no invitation list). Own icon, full screen, microphone that behaves. The download and the step-by-step install walk-through live on the new <a href="/help/android">Android App page</a>.</li>
  <li><strong>Call your Spotter directly.</strong> There's now a second button right next to the phone button at the top of a conversation &mdash; the radio-tower icon. One tap starts a fresh call and puts your Spotter straight on the line, no need to call a character first and switch. Your character still picks up for a second to hand the call over, then it's all Spotter.</li>
  <li><strong>A flashlight for dark rooms &mdash; and it turns itself on.</strong> On a video call using the rear camera, a flashlight button appears next to the camera controls whenever your phone actually has one there. Even better: if the camera sees that it's genuinely dark for a few seconds, the flashlight now <strong>turns itself on once</strong> and says so out loud &mdash; no hunting for the button in the dark. Tap the flashlight button anytime to turn it off (or on); once you touch it yourself, it stays under your control.</li>
  <li><strong>Flip the camera.</strong> Regular video calls got a camera-flip button &mdash; switch between the rear camera (pointing at the world) and the front camera (pointing at you), with a spoken confirmation of which way it's now facing. Spotter calls always use the rear camera, since their whole job is seeing the world for you.</li>
  <li><strong>iPhone app: the call now lives on your Lock Screen.</strong> While you're on a voice call in the app, your Lock Screen (and the Dynamic Island on newer iPhones) shows a live banner &mdash; who you're talking to, whether they're listening, thinking, or speaking, and a running call timer. Lock the phone mid-call, the call keeps going and the banner keeps you posted; hang up and it disappears on its own. Nothing to set up &mdash; it arrives with the newest app build from TestFlight.</li>
  <li><strong>iPhone app: Scan Text, Siri, and Lock Screen widgets.</strong> The newest app build adds a scanner button in the app header ("Scan mode &mdash; point the camera at text"), a Siri phrase &mdash; <em>"Scan text in Kade-AI"</em> &mdash; that jumps straight to the scanner, and two Lock Screen widgets (Start a Call and Scan Text) you can add from the Lock Screen customize screen. One tap from a locked phone into a call or a scan.</li>
</ul>

<h2>July 16, 2026</h2>
<ul>
  <li><strong>Meet your Spotter &mdash; your own live companion.</strong> Brand new: every account can design ONE personal live companion at <a href="https://kademurdock.com/spotter">kademurdock.com/spotter</a> (also under Explore &rarr; Your Spotter) &mdash; name them (or roll a random name), pick one of eight voices you can audition right on the page, and give them a personality by writing it, taking a quick quiz, or pressing one button to generate it. On any video call, the radio-tower button &mdash; or just asking your character to <em>"get [their name]"</em> &mdash; hands the call to your Spotter: <strong>continuous</strong> sight instead of snapshots, instant back-and-forth, and they'll speak up on their own when something's worth mentioning. Your character announces the handoff and comes back when you say <em>"live off."</em> Same Spotter no matter which character you were talking to. It runs on a pricier engine, so it gets its own small daily allowance (about 15 minutes) &mdash; your character explains all of that the first time.</li>
  <li><strong>Video is now just Video.</strong> The two camera buttons (standard and HQ) became one. Everyone gets the best eyes now &mdash; no more choosing a quality, no more wondering which button reads pill bottles better. One camera button for snapshots-style video, one radio-tower button for your Spotter, done.</li>
  <li><strong>Four new voices, two retired.</strong> Voices 325 through 328 just joined the picker &mdash; browse to the end of the list and give them a listen. Two older voices (118 and 270) left the picker; if something of yours was already using one, it keeps working exactly as before.</li>
  <li><strong>Cleaner conversation titles.</strong> Titles now name what the conversation was actually about more reliably, stray symbols stopped sneaking in, and call conversations in your chat history are stamped in Central time instead of a server clock several hours off.</li>
  <li><strong>Ask her to watch for something &mdash; video calls can now interrupt you (only when you ask).</strong> On a video call, tell the character to watch for anything you care about &mdash; <em>"tell me when a car pulls up," "let me know when the dryer light goes off," "watch the door and tell me when someone comes in"</em> &mdash; and an automatic checker quietly looks every few seconds. The moment it's visible, she takes one fresh look and <strong>speaks up on her own</strong>, in her own voice. Alerts wait for a quiet moment (never talk over you), watches are one-shot and re-armable, and one that sees nothing for half an hour says so and stands down instead of dying silently. Full details on the <a href="/help/voice">Talking &amp; Listening page</a>.</li>
  <li><strong>"Feed the Server" is now "Usage &amp; Balance" &mdash; and the money deal is official.</strong> Every account starts with $10 of credit loaded by Kade; everything draws from your balance at exactly what it costs (no markup, no profit); when it runs dry, top up any amount through the PayPal button and it's added to your account. Chat stays nearly free &mdash; the $10 lasts months of talking &mdash; it's pictures, calls, and video that draw it down. Same page as before, honest new name: <a href="/help/donate">Usage &amp; Balance</a>.</li>
  <li><strong>New low-vision display options.</strong> Settings &rarr; General &rarr; Accessibility now has three new controls: a <strong>High contrast (true black)</strong> theme &mdash; pure black background, bright white text, stronger borders everywhere; an <strong>Easy-read font</strong> picker with Lexend (designed for low vision) and OpenDyslexic (dyslexia-friendly); and a <strong>Line spacing</strong> control that gives text room to breathe. All three work on the website and in the iPhone app, and they remember your choice per device.</li>
  <li><strong>Reading view.</strong> Every AI reply now has a book-icon button next to the play and copy buttons that opens the reply full-screen &mdash; big text, nothing else on screen, close with the button or Escape. Made for actually reading long answers with limited vision instead of squinting at chat bubbles. It follows your font and spacing choices above.</li>
  <li><strong>Describe-It plays it straight about certainty.</strong> The photo-describing specialist now tells you how sure it is when lighting or blur makes reading risky, gives both readings when two are plausible, and for high-stakes stuff &mdash; medication labels, dosages, expiration dates, money &mdash; it always recommends a human double-check and can pass a note to a family member to take a look. It also says where information comes from ("based on the photo you sent earlier," "that part's a best guess") so you're never guessing about its guessing.</li>
  <li><strong>Video calls (in-app).</strong> On an in-app voice call, two new buttons next to Hang Up let a character see through your camera while you talk. <strong>Video</strong> (camera icon) is the casual, everyday lane on your front camera. <strong>HQ video</strong> (eye-scan icon) uses your rear camera and the platform's sharpest vision &mdash; built to read labels, mail, and screens word for word, and to describe a room's layout (what's left, right, ahead) for getting oriented. Either lane checks in automatically every few seconds AND takes a brand-new look the instant you ask anything, so it's never far behind what the camera's actually seeing. A camera-off button stops the meter without ending the call. First use of either mode gets a one-time spoken heads-up about the daily minute allowance &mdash; it costs more than voice, so it isn't unlimited the way talking is. Full explanation, including how it's different from Describe My World, on the <a href="/help/voice">Talking &amp; Listening page</a>.</li>
  <li><strong>Describe-It sees sharper now.</strong> Describe My World &mdash; and a character's own eyes on a photo you drop into chat &mdash; now run on the platform's top vision model instead of the budget one, meaningfully better at reading small or blurry text: medication labels, mail, receipts, signs. Same page, same steps, just sharper eyes behind it.</li>
  <li><strong>Building your own character got friendlier.</strong> Every tool in the character builder now has a plain-English hover explanation &mdash; what it does, what it can't do, and an example ask &mdash; so you don't need to be a programmer to pick the right ones. The model picker got the same treatment: an honest note under each curated model (fastest, sees images, best for uncensored writing, and so on) right where you're choosing.</li>
</ul>

<h2>July 15, 2026</h2>
<ul>
  <li><strong>Any character can text your phone now.</strong> Ask one to ping you right now &mdash; <em>"send me a note that says the laundry's done"</em> &mdash; or to check in on you on a repeating schedule &mdash; <em>"text me every evening around 6"</em>. Ask what check-ins you have going, pause one, or cancel one just as easily, all in chat. This is a real lock-screen notification through the <strong>Kade-AI iPhone app</strong> specifically (not the browser push on the <a href="/notifications">Notifications &amp; Reminders</a> page) &mdash; free, and it shares the same quiet hours (9pm&ndash;8am Central) and daily caps as everything else here, so it can't turn into spam. More on the <a href="/notifications">Notifications &amp; Reminders page</a>.</li>
</ul>

<h2>July 13, 2026</h2>
<ul>
  <li><strong>Kiana and the main crew got new brains.</strong> Kiana, Zadiana, Deuce, Torch, and Lyric moved to Grok 4.20 — conversations run way longer before anyone forgets the early parts, replies come quicker, the storyteller rambles are back, Deep Think works, and you can drop a photo into chat for any of them to look at. Same personalities, bigger engines.</li>
  <li><strong>Calls understand conversation better.</strong> Both the phone line and in-app calls switched to Deepgram's newest listening model (Flux) — it's built for back-and-forth talk, so it's smarter about knowing when you're done speaking versus just pausing for breath. If anything sounds off, Kade can flip back instantly.</li>
  <li><strong>Family messages.</strong> Tell any character "tell Skylee her playlist is ready" and the site holds the message and passes it along the next time she opens a chat, calls in, or takes a call — in the sender's own words, marked as from you. Works from every character, free.</li>
  <li><strong>Reminders are edit-proof now.</strong> A bug meant that editing the wording of a reminder card (or the weekly memory tidy-up touching it) could quietly turn the alarm off while keeping the note. Fixed — the schedule survives any rewording, and reminder cards now show their fire time in the memory panel's card list.</li>
  <li><strong>Voice commands work everywhere now.</strong> "Switch to voice 67," "change your voice to Sarah," "what voice is this?" — these worked on the phone line but quietly didn't on in-app calls. Now one brain handles both, with more natural phrasings ("too fast" slows her down, "I want Kiana" switches characters).</li>
  <li><strong>Call transcripts read clean.</strong> The Calls page no longer shows internal computer tags in old or new transcripts, and in-app calls now remember you the same way phone calls do.</li>
  <li><strong>Cadence got her voice back.</strong> A builder bug from earlier this month had silently muted her — she's back on her old voice, and the bug that did it was fixed for every character.</li>
</ul>

<h2>July 12, 2026</h2>
<ul>
  <li><strong>114 new voices.</strong> The voice picker grew from 210 to 324 — Voices 211 through 324 are brand-new custom characters Kade designed: preachers, podcasters, grannies, chefs, detectives, surfer dudes, a whispering ghost, an Aussie, an infomercial guy, and more. Every voice you already use kept its exact number. Browse them from any character's voice picker — each one introduces itself as you arrow through.</li>
  <li><strong>The whole cast writes better.</strong> A tuning pass on every character fixed a quirk where very long replies (big lists especially) would fall apart toward the end.</li>
</ul>

<h2>July 11, 2026</h2>
<ul>
  <li><strong>Describe My World.</strong> Share or pick any photo, video, PDF, or document and hear it described in rich detail — or read to you word for word. Letters and appointment papers even offer to set reminders for dates they mention. Find it in the account menu ("Describe a Photo or Document") or read <a href="/help/describe">how it works</a>.</li>
  <li><strong>Family check-in calls.</strong> A character can call somebody you love on a schedule — a warm companion chat — and send you a written report on how they're doing. Registered family only, honest AI introduction, starts paused until you test it. Details on the <a href="/help/phone">Phone Calls page</a>.</li>
  <li><strong>VoiceOver got smoother.</strong> Messages no longer read twice as you swipe through a chat, and the automatic read-out of new replies now skips the internal computer tags it used to pronounce.</li>
</ul>

<h2>July 10, 2026</h2>
<ul>
  <li><strong>Memory cards.</strong> What characters remember is now tidy little one-topic cards you can see, edit, and delete one at a time (side panel &rarr; Memories). Tell any character "remember this," "forget that," or "clean up your memory" and it listens. More on <a href="/help/memory">What It Remembers</a>.</li>
  <li><strong>Reminders &amp; nudges.</strong> Tell any character "remind me to take my meds at 9" and it actually will — in chat, as an iPhone notification, or by phone call, your choice on the new <a href="/notifications">Notifications &amp; Reminders</a> page. Birthday hellos are in there too (off unless you want them).</li>
  <li><strong>Replies stream in live again</strong> for the whole cast — no more silence-then-wall-of-text, and voice calls start speaking almost immediately.</li>
</ul>

<h2>July 9, 2026</h2>
<ul>
  <li><strong>Better in-app voice calls.</strong> The phone button in the app now runs on the same engine as the real phone line: interrupt her just by talking, hear game sounds live, and it all lands in <a href="/help/voice">Call History</a>.</li>
  <li><strong>A face on the call.</strong> Your character's picture now fills the call screen and gently "breathes" with the voice.</li>
</ul>

<h2>July 8, 2026</h2>
<ul>
  <li><strong>Muse sings.</strong> A new character who turns lyrics into a real, fully sung song. Pair her with Lyric (writes the words) and Cadence (cinematic audio scenes). See <a href="/help/audio">Making Audio &amp; Voices</a>.</li>
</ul>

<h2>Early July, 2026</h2>
<ul>
  <li><strong>The Game Parlor</strong> — nineteen real games by voice or phone with table sounds and a family <a href="/game-room">leaderboard</a>.</li>
  <li><strong>The Debate Room</strong> — put a few characters in one room and let them go at it, radio-play style if you want. <a href="/help/debate-room">How it works</a>.</li>
  <li><strong>Starting balance</strong> — every account starts with $10 of usage credit, and <a href="/help/donate">Usage &amp; Balance</a> shows exactly where it goes.</li>
</ul>

<p class="muted">Older history lives with Kade. If something here confuses you, the <a href="/help">help home</a> has a page for everything.</p>
${nextprev("faq", "voice")}
`,
};

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
<p>Most characters come with a voice their creator picked for them, so they each sound like themselves. Prefer something else? There are <strong>over five hundred</strong> voices — calm ones, warm ones, dramatic ones, silly ones.</p>
<p>You can hear any of them right in the chat — no separate page needed. Open <strong>Settings → Speech → Text-to-Speech → Voice</strong>, pick a voice from the list, then tap the <strong>Preview</strong> button to hear a short sample. When one sounds right, just leave it selected and that becomes your voice.</p>
<div class="callout good">
  <p><strong>Hearing a flat, robotic "system" voice instead of the nice ones?</strong> Check <strong>Settings → Speech → Text to Speech → Engine</strong> — it should say <strong>External</strong>. Flip it there once and the real voices come back.</p>
</div>

<h2>Have a whole voice conversation</h2>
<p>Next to the message box there's a <strong>phone button</strong>. Tap it and the screen turns into a call — you talk, the character talks back in its own voice, no typing at all. Tap the amber button if you want to jump in while it's speaking, and hang up whenever you're done. (The first tap will ask for microphone permission.)</p>

<h2>NEW: in-app calls run on the phone engine now — fast replies, interrupt by just talking</h2>
<p>The call screen got the real phone line's whole engine. Nothing to turn on — tap the phone button and it's just how calls work now:</p>
<ul>
  <li><strong>Replies start in a couple of seconds.</strong> The character speaks the first sentence while it's still writing the rest, instead of making you wait for the whole answer.</li>
  <li><strong>Interrupt by just talking.</strong> No button hunting — start speaking and she stops mid-word, exactly like the phone line. (The amber button still works too.)</li>
  <li><strong>Little "mm-hm"s don't derail her.</strong> Nod along out loud all you want; she keeps going.</li>
  <li><strong>Spoken commands work.</strong> "Can I talk to Zadiana?", "speak faster", "slow down", "deep think on" — same as the phone.</li>
</ul>
<p>Every call — web or phone — is saved as a <strong>written transcript</strong> under <strong>Call History</strong> in the main menu. Transcripts only; no audio recordings of you are kept from these calls.</p>
<p>And yes — there's a REAL phone line too. That's big enough to get <a href="/help/phone">its own page</a>.</p>

<h2>Seeing through your camera: video calls</h2>
<p>On an in-app call (not the real phone line — a phone can't send video), a character can look through your camera while you talk. One <strong>camera button</strong> appears next to Hang Up once you're on a call — tap it and the character sees through your <strong>rear</strong> camera with the platform's sharpest vision: built for reading labels, mail, screens, and small details out loud, word for word, and for describing a room's layout so you can get oriented.</p>
<div class="term">A few helpers appear alongside once video is on: a <strong>flip button</strong> switches between the rear camera (the world) and the front camera (you), with a spoken confirmation of which way it now faces. A <strong>flashlight button</strong> shows up whenever your phone actually has a flash on the running camera — and if the camera sees that it's genuinely dark for a few seconds, the flashlight turns itself on once and says so; touch the button yourself and it stays under your control from then on. Spotter (live-mode) calls always use the rear camera.</div>

<h3>It's not a nonstop video feed — here's what it actually does</h3>
<p>To be completely honest about how this works: the character isn't watching smooth, flowing video the way a person on a video call would, and it doesn't interrupt you the way a person would either. Two separate things are happening, and it helps to know both:</p>
<ul>
  <li><strong>In the background, it quietly refreshes its own notes every so often</strong> &mdash; roughly every 15&ndash;20 seconds, depending on the mode &mdash; just to keep what it "currently knows it's looking at" up to date. This part is silent. It does NOT speak up or interrupt when this happens; it's only updating what it would say if you asked.</li>
  <li><strong>Separately, every single time you say anything at all,</strong> it grabs one more guaranteed fresh look before replying &mdash; so a direct question like "what am I looking at?" is never answered with stale information.</li>
</ul>
<p>The upshot: it speaks when you speak to it, like any normal conversation &mdash; turn-taking, not a running commentary &mdash; with exactly <strong>one exception you control</strong>: a watch you've armed (next section). Outside of a watch, it never interrupts on its own; check in whenever you like &mdash; <em>"is she here yet?"</em> &mdash; and each check gets a genuinely fresh, current answer.</p>
<p>It also keeps a short memory of what it noticed changing &mdash; a few minutes' worth &mdash; so a check-in isn't limited to only the instant you happen to ask. "Did anything happen?" or "did a car pull up?" can be answered from something it noticed a couple of minutes ago, not just whatever's in frame right this second. It still won't volunteer that on its own; you still have to ask. Think of it as catching you up when you check in, not as it keeping watch and reporting back.</p>
<p>This is different from <a href="/help/describe">Describe My World</a>, which is a one-time "here's a photo, describe it once." Video calls keep re-checking automatically for as long as the camera's on, without you having to re-share anything &mdash; more like having someone stay on the line looking with you (who only talks when you talk to them), less like snapping a single picture.</p>

<h3>NEW: Your Spotter &mdash; live mode</h3>
<p>On a video call, the radio-tower button (or asking for your Spotter by name) hands the call to your own live companion: continuous sight, instant replies, their own voice and personality &mdash; the one you design at <a href="https://kademurdock.com/spotter">kademurdock.com/spotter</a>. Your character announces the handoff, and saying <em>"live off"</em> (or the button again) brings your character right back. Live mode uses a more expensive engine, so it has its own small daily allowance, separate from regular video minutes.</p>
<p><strong>New:</strong> you can also call your Spotter <em>directly</em> — the radio-tower button sits right next to the phone button at the top of a conversation. One tap starts a fresh call and hands it straight to your Spotter.</p>

<h3>NEW: Ask her to watch for something &mdash; the one time it WILL speak up on its own</h3>
<p>This is the feature the fine print used to say didn't exist. Now it does. On a video call, say something like <em>"tell me when a car pulls into the driveway,"</em> or <em>"watch the door and let me know when the kids come in,"</em> or <em>"tell me if the oven light turns off."</em> Pets count too, if that's your thing. The character confirms, and from that moment a quiet automatic checker looks at the camera every few seconds for exactly that thing. The moment it's actually visible, <strong>the character takes one fresh, careful look and speaks up on her own</strong> &mdash; a real interruption, in her own voice, with what she's seeing. You asked to be interrupted; that's the one time she will.</p>
<ul>
  <li><strong>It waits for a quiet moment.</strong> An alert never talks over you &mdash; if you're mid-sentence or she's mid-reply, it holds until the line is clear, then speaks.</li>
  <li><strong>One watch at a time, and it's one-shot.</strong> After an alert fires, the watch turns itself off &mdash; say "keep watching" or just ask again to re-arm it. Asking to watch a new thing replaces the old one.</li>
  <li><strong>To stop early,</strong> just say so: "stop watching," or "never mind."</li>
  <li><strong>It won't run forever.</strong> A watch that hasn't seen its thing after about half an hour says so out loud and stands down &mdash; it never dies silently while you're counting on it.</li>
  <li><strong>Point the camera where the action would happen.</strong> The checker can only see what the camera sees &mdash; a watch for the front door works best with the phone propped facing the front door.</li>
  <li><strong>Cost, honestly:</strong> the repeated checking uses the cheapest possible look (well under a nickel an hour), and the alert itself costs about as much as any normal reply. It all comes out of the same video minutes and balance as the rest of the call.</li>
</ul>

<h3>Getting oriented with HQ video</h3>
<p>If you're blind or low-vision and using HQ video to get your bearings in a room, two habits help a lot: <strong>ask out loud as you go</strong> — "what's in front of me now," "what's to my left" — each question forces an instant fresh look, so it always matches wherever you've just pointed the camera. And <strong>pause a beat after you turn or pan</strong> before asking, so the look it takes isn't a blur. HQ is written to describe layout in plain terms — what's left, right, and ahead, and roughly how far — not just list objects, and to call out anything relevant to moving safely, like steps or obstacles, when it can see them.</p>

<h3>Pointing a camera, if that's new to you</h3>
<p>Not used to aiming a phone camera? A few basics: hold the phone with the camera lens (a small dark circle on the back, opposite the screen) facing what you want described. Keep it steady for a couple of seconds rather than sweeping it around fast — a still, held shot reads far better than a blur. Good light helps more than almost anything else; try not to point toward a bright window or lamp with the object sitting in shadow in front of it. If a description comes back confused or says it can't tell, that's the cue to hold it closer, steadier, or move to better light — the character will often ask for exactly that on its own.</p>

<h3>Turning it off without hanging up</h3>
<p>Once video's on, a third button (a camera with a line through it) appears — activate it and the camera turns off and stops using your daily minutes, but the call itself keeps going as a normal voice call. Handy the moment you're done showing something and want to save the rest of your allowance for later.</p>

<h3>The honest fine print</h3>
<ul>
  <li><strong>It costs more than voice, so it's not unlimited.</strong> Video uses real per-look AI vision costs behind the scenes, so it gets its own daily minute allowance separate from voice (voice chat itself stays unlimited either way). The first time you ever turn a camera on, you'll hear a one-time heads-up explaining the allowance — after that it just works.</li>
  <li><strong>Nothing is recorded or saved.</strong> Only the single newest camera frame ever sits in memory for the length of the call — never written to disk, never kept after you hang up or turn the camera off.</li>
  <li><strong>Camera permission required.</strong> The first time, your browser will ask to use your camera — say yes. If it seems blocked, check your browser's site settings for this page.</li>
  <li><strong>Web calls only, for now.</strong> Video works on in-app calls in a browser or the installed app. The real phone line (<a href="/help/phone">1-833-530-0313</a>) is voice-only.</li>
  <li><strong>Watch alerts are the one sanctioned interruption.</strong> Armed watches (see the "ask her to watch for something" section above) are the only time a character will ever speak unprompted &mdash; because you explicitly asked for it. Everything else stays strictly turn-taking: no watch armed, no surprises, ever.</li>
  <li><strong>It also remembers recent changes.</strong> Separate from watches, a short rolling memory (roughly the last five minutes) of anything that noticeably changed is kept, so a check-in like "did anything happen?" can catch you up on something you missed rather than only describing the current instant. That part still waits for you to ask &mdash; it just has more to say when you do.</li>
</ul>
<div class="callout">
  <p><strong>The bigger dream — a truly continuous live camera, like smart glasses:</strong> Kade knows this is where a lot of people's minds go, and it's genuinely on her radar (the technology to do it now exists). It's deliberately not built yet because running continuously, instead of look-by-look, changes the cost math completely — that gets a real number put in front of Kade, and an actual yes, before it ever ships. What's live today is the look-and-report version described above.</p>
</div>
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

<h2>Your characters can call YOU</h2>
<p>Newest trick of all: ask a character to <strong>call you</strong> — a wake-up call, a <em>"call me at 8 about my meds,"</em> a Sunday catch-up by voice — and at that exact moment your <strong>iPhone app rings like a real call</strong>, with a ringtone you picked. Tap <strong>Answer</strong> and you're instantly in a live voice conversation, and the character already knows why it called — no "what did you need?", it just gets into it.</p>
<ul>
  <li><strong>Set it up in plain words:</strong> <em>"call me tomorrow at 8 about my meds"</em> &middot; <em>"wake me up at 7 every weekday"</em> &middot; <em>"call me Sunday afternoon to catch up."</em> Ask what calls you have set, pause one, or cancel one — all in chat.</li>
  <li><strong>Pick your ringtone.</strong> In the app: Settings &rarr; Calls &rarr; <strong>Agent call ringtone</strong> &mdash; 72 of Kade's homemade tones plus the classics, grouped by feel, and tapping one plays the whole preview out loud so you choose by ear (Stop preview hushes it). A character can also set a different tone for one specific call by name ("use Morning Raga for my wake-up").</li>
  <li><strong>Quiet hours are respected.</strong> Scheduled calls don't ring between 9pm and 8am Central unless you specifically told that call to — a wake-up call can, because you asked it to. If quiet hours hold a call back, you get an honest morning note about it instead.</li>
  <li><strong>Miss it? No drama.</strong> If you don't answer, the ringing stops on its own and the character leaves a note on your lock screen — "tried to call you at 8, call me back when you're free."</li>
  <li><strong>It's free.</strong> These ring through the app, not the phone line — no per-minute anything. A sensible daily cap keeps it from ever turning into spam.</li>
  <li><strong>Needs the iPhone app</strong> — a current version from TestFlight. The 833 number and the browser can't do this one yet.</li>
</ul>

<h2>Characters can make calls FOR you</h2>
<p>This is the wild one. Ask a character to call a real place — <em>"call the pharmacy and ask if my refill is ready"</em> — and it actually dials, has the conversation out loud, and reports back what was said.</p>
<p>The honest fine print, so nothing surprises you:</p>
<ul>
  <li><strong>The call says who it's for.</strong> Every call opens with the AI introducing itself and naming you (first name only) as the person who asked for it. That's on purpose — no anonymous prank calls, ever.</li>
  <li><strong>Calls are recorded</strong> and the other person is told so, so there's always a record of what was said.</li>
  <li><strong>It costs a little</strong> — about a cent and a half per minute, added to your tab on the <a href="/help/donate">Usage &amp; Balance</a> page. The character will mention this before dialing.</li>
  <li><strong>There are limits</strong> — calls cap at 15 minutes and a handful per person per day, so nobody can go wild with it.</li>
</ul>

<h2>Make it really think: deep think</h2>
<p>On the phone, characters answer <strong>fast</strong> by default — great for chatting, not always enough for a hard question. Say <em>"think hard about this"</em> or <em>"deep think on"</em> and the character switches into deep-thinking mode for the rest of the call: answers take a little longer (you'll hear the little typing sound while it works), but they're much more carefully reasoned. Say <em>"back to quick answers"</em> to switch back.</p>
<p>You can also just bake it into the question — <em>"think hard about whether I should refinance the car"</em> — and it'll go deep on that without any announcement.</p>

<h2>Your morning news briefing, by phone</h2>
<p>New: you can sign up for a <strong>morning briefing call</strong>. At your chosen time, your character calls you and runs through the day's headlines — national news, world news, Springfield/Ozarks local, sports, music, whatever mix you want — morning-radio style, and you can ask about any story. <strong>Contact Kade</strong> to get set up.</p>
<p>Prefer it on demand? Just ask any character <em>"what's the news this morning?"</em> in chat or on a call — same headlines, no schedule.</p>

<h2>Passing messages between family</h2>
<p>Tell any character "tell Skylee her playlist is ready" (or "let Kade know the gate's fixed") and the site takes the message and delivers it the next time that person opens a chat or is on a call with a character — word for word, marked as from you. If two people share a name, the character will ask which one; an email settles it. Free.</p>

<h2>Family check-in calls</h2>
<p>Newest of all: a character can <strong>check in on somebody you love, on a schedule</strong>. Pick a registered family member, a time, and the days — every day at 10, or just Monday and Thursday — and the character calls them for a warm, unhurried chat: how are you doing, what's new, whatever they feel like talking about. You can tell it things to weave in ("ask about his garden, make sure he's eating okay").</p>
<p>Afterwards, <strong>you get a written report</strong> — how they seemed, what they talked about, anything they mentioned needing — delivered as a nudge, whichever way you chose on the <a href="/notifications">Notifications &amp; Reminders</a> page.</p>
<p>Set one up either way:</p>
<ul>
  <li><strong>Just ask a character:</strong> <em>"set up a daily check-in call for Dad at 10am"</em> — or ask what schedules you have, pause one, cancel one.</li>
  <li><strong>Or use the page:</strong> the "Family check-in calls" section on <a href="/notifications">Notifications &amp; Reminders</a> lists your schedules with pause, test, and delete buttons.</li>
</ul>
<p>The honest fine print, same spirit as everything here:</p>
<ul>
  <li><strong>Registered family only.</strong> These calls can only go to numbers Kade has registered — nobody can point them at strangers.</li>
  <li><strong>Same up-front AI honesty.</strong> The call introduces itself as an AI calling on your behalf, and it's recorded. If your person says they'd rather not get the calls, that lands front and center in your report — and you can pause the schedule right there.</li>
  <li><strong>New schedules start paused.</strong> Use <em>"Call me as a test"</em> first so YOU hear exactly what your family will hear, then resume it.</li>
  <li><strong>It costs a little</strong> — roughly a nickel to a dime per call (a daily schedule runs a few dollars a month), on your <a href="/help/donate">Usage &amp; Balance</a> tab. Calls run between 8am and 9pm Central only.</li>
</ul>
${nextprev("voice", "describe")}
`,
};

// ---- 4a2. DESCRIBE MY WORLD (July 11 2026) ---------------------------------
PAGES.describe = {
  title: "Describe My World",
  h1: "Describe My World",
  tagline: "Share any photo, video, or document and hear it described in rich detail — or read to you, word for word.",
  main: `
<p class="lead">This one was built blind-first from the ground up. Hand Kade-AI a photo, a video, a PDF, a Word file, or a text file — from your phone's share menu or a big friendly button — and seconds later a page opens, describes it richly, and starts reading it out loud.</p>

<div class="callout">
  <p><strong>Not the same as a video call:</strong> this page is a one-time "here's a photo or video file, describe it" — you hand it something and get one description back. If you want a character to keep looking through your camera WHILE you talk — checking in automatically, live, and taking a fresh look every time you ask — that's <a href="/help/voice">video calls</a> on an in-app voice call instead.</p>
</div>

<h2>What you get</h2>
<ul>
  <li><strong>Photos:</strong> a real description — who's in it, what they're wearing and doing, expressions, colors, lighting, what's in the background — and any words in the picture read out <em>verbatim</em>. Letters, signs, screenshots, receipts: it reads them word for word.</li>
  <li><strong>Videos:</strong> what happens from start to finish, moment by moment, plus any on-screen text.</li>
  <li><strong>PDFs, Word docs, and text files:</strong> a plain-language summary first — what is this, who's it from, what matters — then the full text, read aloud.</li>
  <li><strong>Dates get noticed.</strong> If a document mentions an appointment or due date, you'll get a "Save reminder" button for each one — press it and it becomes a real reminder that nudges you the way you picked on <a href="/notifications">Notifications &amp; Reminders</a>.</li>
</ul>
<p>The page puts a big <strong>Play</strong> button first thing, starts reading automatically when your browser allows it, and has Stop and speed controls right there. Everything is labeled for screen readers.</p>

<h2>The easiest way: right from the app</h2>
<p>Open the account menu (top right) and choose <strong>Describe a Photo or Document</strong> — or go straight to <strong>kademurdock.com/describe</strong>. Press <strong>Choose a photo or document</strong>, pick from your camera roll or files, done.</p>

<h2>iPhone: put it in your share sheet (one-time setup)</h2>
<p>Apple doesn't let websites appear in the iPhone share menu on their own, so there's a one-time trick using the Shortcuts app — about two minutes, and the <a href="/describe">Describe page</a> walks you through it step by step with your own personal link. After that: any photo or PDF → <strong>Share</strong> → <strong>Describe with Kade-AI</strong> → the page opens and starts reading.</p>
<div class="callout">
  <p>Your personal link on that page works like a password for descriptions on your account — don't post it anywhere public. If it ever leaks, tell Kade and she can rotate it.</p>
</div>

<h2>Android: it just shows up</h2>
<p>On Android, install Kade-AI to your home screen (Chrome menu → Add to Home Screen) and <strong>Kade-AI appears in the regular share menu by itself</strong> — share a photo to it like you'd share to Messages.</p>

<h2>The honest fine print</h2>
<ul>
  <li><strong>Cost:</strong> around a tenth of a cent per description — pocket lint, but it's on your <a href="/help/donate">Usage &amp; Balance</a> tab like everything else.</li>
  <li><strong>Privacy:</strong> the file itself is described and thrown away within the hour — it's never saved to the site. (The description text stays on your screen until you leave the page.)</li>
  <li><strong>Size limit:</strong> about 30&nbsp;MB — photos and documents are always fine; a very long video might not fit.</li>
</ul>
${nextprev("phone", "characters")}
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
  tagline: "Two or more characters, one room, one topic — or no topic at all on the front porch — and you, whenever you feel like jumping in.",
  main: `
<p class="lead">The Debate Room lets you drop a handful of characters into one conversation and give them something to chew on. They'll argue, agree, gang up, and crack jokes — with each other, not just with you. You can sit back and listen, or wade in anytime.</p>

<h2>Where it is</h2>
<p>Open the account menu (your name, bottom-left corner), choose <strong>Explore</strong>, then <strong>Debate Room</strong>. Or go straight to <strong>kademurdock.com/debate-room</strong>.</p>

<h2>Starting a room</h2>
<ol>
  <li><strong>Pick a room style.</strong> <em>Debate &amp; roleplay</em> wants a topic; <em>Front porch</em> doesn't need one.</li>
  <li><strong>Give it a topic or a scene</strong> (debates only — the porch skips this). Anything: "Pineapple on pizza — settle it," or "You're a ship's crew and the ship is sinking."</li>
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

<h2>The front porch — no topic, just company</h2>
<p>Sometimes you don't want a debate; you want company. Pick <strong>Front porch</strong> as the room style and the same characters stop competing and just sit with you — swapping stories, teasing each other gently, asking after your day. No topic needed (there's a default evening porch waiting), though you can set the scene if you like: "the porch after a thunderstorm," "shelling peas at dusk." Everything else works the same: take turns, run rounds, let them cook, jump in whenever, share the good ones to the Hall.</p>

<h2>Read aloud — radio-play mode</h2>
<p>Turn on <strong>Read aloud</strong> in the room and every character's turn is spoken out loud <em>in that character's own voice</em>, one after another. It turns a debate into a little radio drama. Your choice is remembered for next time.</p>

<h2>The Conversation Hall</h2>
<p>Had a conversation so good it deserves an audience? Press <strong>Share to the Hall</strong>, give it a title, and it appears in the <a href="${CHAT_URL}/conversation-hall">Conversation Hall</a> — the public greatest-hits shelf everyone on the site can read. You can unshare or delete your room anytime, and deleting the room removes it from the Hall too.</p>

<h2>The small print (tiny, promise)</h2>
<p>Each character turn costs a fraction of a cent, and it shows on your <a href="/help/donate">Usage &amp; Balance</a> tab like everything else. There's a daily limit high enough that you'll never notice it in normal use. Rooms stick around until you delete them, so you can come back to a good one tomorrow.</p>
`,
};

PAGES.games = {
  title: "The Game Parlor",
  h1: "The Game Parlor",
  tagline: "Real games you play out loud — the dealer handles the cards and dice, you bring the trash talk.",
  main: `
<p class="lead">The Game Parlor is a room full of games you can play entirely by voice or by typing — no board to look at, nothing to see. Every card is read out to you by name, and a real dealer keeps the game honest. You just say what you want to do.</p>

<h2>New: characters in the seats (Hearts &amp; poker night)</h2>
<p><strong>Hearts</strong> and <strong>Five-Card Draw</strong> joined the parlor, and they take real characters as players. Try: <em>"deal up hearts with Sterling and Nana Pearl"</em> or <em>"poker night &mdash; seat Vinnie and Uncle Todd."</em> Each character sees only their own hand, plays by the same rulebook you do, and talks at the table in their own voice. The dealer's code still referees every card &mdash; personalities bring the banter, never the shuffle.</p>
<p><strong>The chip bank:</strong> casino games (Blackjack, poker) settle into your own persistent stack of fake chips &mdash; never real money. Ask any character <em>"how are my chips?"</em> or visit the <a href="https://kademurdock.com/game-room-page">Game Room</a> for the family standings and your open tables.</p>

<h2>The Parlor &mdash; play from a menu instead</h2>
<p>Prefer picking your own cards to talking them through? <a href="https://kademurdock.com/parlor">The Parlor</a> lists every game on a menu &mdash; choose one, set the table (characters optional), and every legal move is a real button. A house narrator in Kade's or Miss A's voice calls the table (or turn it off and let your screen reader drive), table talk keeps the company, and every table's transcript downloads for memories and bragging rights. Same tables as chat and the phone line either way.</p>

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
<p>The games themselves are free — no tokens, no cost. Chips in Blackjack are pretend and can never turn into real money. If a character sings you a song or draws a picture during game night, that part follows the usual costs on your <a href="/help/donate">Usage &amp; Balance</a> tab, but the card games are on the house.</p>
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

<h2>The two sections that make a character sound REAL</h2>
<p>House convention, learned from the best companion platforms and now standard here. At the end of your character's instructions, add these two sections &mdash; plain text, exactly this simple:</p>
<ul>
  <li><strong>Example messages.</strong> Write three to five replies your character would actually send &mdash; a greeting, an answer to something they don't know, a comfort moment, a favor. A character learns its sound from hearing itself talk far better than from any pile of adjectives. Label the section "How you sound (example messages)" and note they're anchors, never scripts to repeat.</li>
  <li><strong>Standing directives.</strong> Behavior rules, kept separate from personality: "never open with a question," "keep replies short unless asked," "no lists in casual talk." Keeping the RULES apart from the SOUL means you can tighten one without wrecking the other. Label it "Standing directives."</li>
</ul>
<p>Kiana herself carries both sections now &mdash; that's the house pattern to copy.</p>

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
<p class="lead">Kade-AI has a <strong>memory</strong> feature. Over time, it holds onto useful facts you've shared, so you don't have to repeat yourself in every new chat.</p>

<div class="term"><strong>Memory cards</strong> — each thing it remembers is its own small card, one topic per card: "has a dog named Biscuit," "hates cilantro," "going to the Shinedown show in July." Like a friend remembering the gist of you, not a recording of everything you've ever said. Each card can be looked at, fixed, or thrown out on its own.</div>

<h2>Coming over from ChatGPT? Bring your memories along</h2>
<p>If ChatGPT already knows you, you don't have to start from scratch here. Go to <a href="https://kademurdock.com/import">kademurdock.com/import</a> and either <strong>paste the memory list</strong> ChatGPT kept about you (ask it: "list everything you remember about me"), or <strong>upload your ChatGPT export zip</strong>. Your facts become normal memory cards — yours to hear, fix, or delete like any other — and if you tick the box, your old conversations get read into your logbook too, dated to the days they really happened. The only thing that reads any of it is the same memory keeper that listens here every day.</p>

<h2>What it tends to remember</h2>
<ul>
  <li>Preferences you mention ("I like things explained simply").</li>
  <li>The people, pets, and goings-on in your life that come up naturally.</li>
  <li>Ongoing stuff — a project, a health thing, plans — so next time it can just ask how it went.</li>
</ul>

<h2>The Logbook: the long story of you</h2>
<div class="term"><strong>Your Logbook</strong> &mdash; beside the cards, every companion keeps a dated logbook of your day-to-day: what happened, how it went, the rabbit holes you went down together. Cards hold who you ARE; the logbook holds what HAPPENED &mdash; and it has no size limit, because it stays on the shelf until a moment calls for it. Ask "what was I up to last week?" or "have I mentioned that before?" and your companion checks the real entries. Old moments also drift back naturally when they fit &mdash; the way a friend goes "wait, didn't you say&hellip;" Browse it all under You &rarr; Your Logbook: every entry by date, who holds it, a Forget button on each, and a box to add a line yourself. Same privacy as cards: an entry belongs to the companion you told. And two magic words work everywhere: say <em>"off the record"</em> and nothing gets remembered &mdash; cards or logbook &mdash; until you say you're back on.</div>

<h2>How memories come to mind (new, August 2026)</h2>
<p>Your companions used to carry every single card into every single message, whether it mattered or not. Now they hold onto the essentials constantly &mdash; who you are, your people, how you like to be spoken to, anything you asked to be reminded of &mdash; and the rest of what they know <em>comes to mind when it's relevant</em>, the way a friend's memory actually works. Mention repainting a room and the color you love surfaces; talk about dinner and it stays out of the way. Nothing was deleted; it's all still theirs to remember &mdash; it just stops crowding the conversation. Every companion works this way.</p>
<p>And the memory does a little connecting of its own now: if separate notes clearly belong together &mdash; a nephew here, his mom named over there &mdash; the notes get introduced to each other. Every one of those tidy-ups is kept on a trail, nothing is ever silently lost, and you can always ask any companion <em>"what changed in your memory lately?"</em> and hear it read back plainly.</p>

<h2>Two kinds of cards: shared, and just-between-you-two</h2>
<ul>
  <li><strong>Shared cards</strong> are the basics every character should know — your name, your people, how you like to be talked to. Tell one character, they all catch up.</li>
  <li><strong>A character's own cards</strong> belong to that one character alone. Inside jokes, story and roleplay threads, promises they made you — another character can't see those, so every relationship stays its own thing.</li>
</ul>

<h2>Really long single conversations</h2>
<p>Separate from memory cards: within one conversation, a character can only hold so many recent messages in its attention at once. In very long chats the earliest messages used to simply fall out of reach &mdash; the "did you forget what we talked about an hour ago?" feeling. Now, when a conversation gets near that limit, the character first writes itself a compact "story so far" checkpoint &mdash; names, promises, running jokes, where things stand &mdash; and keeps chatting from that plus the newest messages. Nothing visible is deleted or rewritten: the whole conversation stays right there to scroll, and a small note marks the one spot where the condensing happened. It's automatic and free, and it works on every character, in text chats and voice conversations alike.</p>

<h2>Bossing the memory around (just talk to it)</h2>
<ul>
  <li><strong>"Remember that..."</strong> — saves a card, even for little stuff.</li>
  <li><strong>"Forget about..."</strong> — deletes the matching card(s), gone for real.</li>
  <li><strong>"What do you remember about me?"</strong> — it'll tell you, plainly.</li>
  <li><strong>"Clean up your memory"</strong> — it merges duplicates and tightens wordy cards.</li>
  <li><strong>"Remind me to take my meds at 9"</strong> — becomes a real reminder that actually fires. Under your account menu, <strong>Notifications &amp; Reminders</strong> lets you pick how reminders reach you: quietly at the start of your next chat (free, no permissions), a real push notification on your phone, or an actual phone call from a character. Same page has an optional once-a-year birthday nudge.</li>
</ul>

<h2>What it does NOT do</h2>
<ul>
  <li>It doesn't memorize every word of every chat, perfectly, forever. It keeps the useful gist — on purpose, so conversations stay quick.</li>
  <li>It won't share your memory cards with other people on the site. Your account, your cards.</li>
</ul>

<div class="callout good">
  <p>Want to see the cards yourself? Open the <strong>side panel</strong> in any chat and look for <strong>Memories</strong> — every card is listed with an edit and a delete button, and cards that belong to one character say so right on them (like "Only Kiana"). If something's wrong or out of date, you can just tell the character instead — "actually, I don't have that dog anymore" — and it updates the card. The system also does its own tidy-up once a week, quietly.</p>
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
<p>The specialists go further than pictures: <strong>Rio</strong> turns a description into a short <em>video clip</em>, and <strong>Indie</strong> makes designed images with clean readable text (flyers, logos, cards). Videos are the priciest thing on the whole site — roughly <strong>50 cents to a dollar per clip</strong> — so the character will casually tell you the ballpark cost before it runs, and the spend lands on your <a href="/help/donate">Usage &amp; Balance</a> page. Regular pictures stay cheap (a few cents) and skip the speech.</p>

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

<h2>Meet Muse, for actual songs</h2>
<p><strong>Muse</strong> is a different character for a different job: turning words into a real <em>song</em> — actual singing, over real music. Where Cadence builds a <em>scene</em>, Muse cuts a <em>track</em>. Find Muse in the marketplace (the <a href="/help/characters">Characters</a> page shows you how), hand over your lyrics and a vibe, and Muse sings them. It plays right there in the chat and saves to your <a href="/my-creations">My Creations</a> page, same as everything else.</p>
<ul>
  <li><strong>From your own lyrics:</strong> paste the words and describe the feel — <em>"a slow soul ballad, warm and aching, about 70 beats a minute"</em> — and Muse records it.</li>
  <li><strong>Straight from Lyric:</strong> if the songwriter character <strong>Lyric</strong> wrote you a song, hand Muse what Lyric gave you and it turns it into the finished track.</li>
  <li><strong>From just a feeling:</strong> no lyrics yet? Describe the mood and Muse can write and sing its own.</li>
  <li><strong>An instrumental:</strong> ask for a backing track with no singing.</li>
</ul>
<p>Muse can sing with Google's <strong>Lyria 3 Pro</strong> (rich, up to about three minutes) or <strong>MiniMax</strong> — if the first take isn't quite right, just ask for the other. A song takes a minute or two to come back, and costs about <strong>8 to 15 cents</strong>, from the same pot as pictures and audio.</p>

<h2>The catch: it costs a little (not much)</h2>
<div class="callout warn">
  <p>Making audio pulls from the same small pot of credits as pictures and video. It's cheap — about <strong>7 or 8 cents a minute</strong>, so a full two-minute scene runs around 15 cents — but the pot isn't bottomless. Make all the audio you like; just don't fire off a thousand at once. The spend shows up on your <a href="/help/donate">Usage &amp; Balance</a> page. If audio ever stops working, the pot may need a top-up — <strong>contact Kade</strong>.</p>
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
    <tr><th scope="row">See my balance / what I've used</th><td>Account menu (bottom-left avatar) → Explore → Usage &amp; Balance.</td></tr>
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
<p class="lead">Every account runs on real, prepaid credit — $10 of it loaded for you on day one, drawn down at exactly what things cost, topped up by you when it runs dry. Here's exactly how it works, no mystery.</p>

<h2>Every message gets processed by an outside AI provider</h2>
<p>Kade didn't build the AI brain from scratch — almost nobody does. When you send a message, it goes out to an outside AI service that does the actual thinking and sends a reply back. That service <strong>charges per token</strong> — those tiny text chunks from the <a href="/help/tokens">tokens page</a>. Every message, in and out, costs a sliver of a cent.</p>

<h2>Kade pre-loads credits to cover it</h2>
<p>So the lights stay on, Kade puts her own money in ahead of time as credits. Your chatting quietly draws that balance down, a few fractions of a cent at a time. It's small per message — but it's real, and it adds up across a whole family of people chatting away.</p>

<h2>Nobody can accidentally run up anybody's bill</h2>
<div class="callout good">
  <p>Here's the reassuring part. Your <strong>balance is the guardrail</strong>: everything you do draws from your own prepaid credit, and when it's empty, spending simply stops until you top it up — no surprise bills, no overdraft, nothing quietly piling up in the background. You genuinely cannot accidentally cost anyone a fortune, including yourself. (Chat is so cheap that the $10 you start with can last months of heavy talking — it's the pictures, videos, and calls that draw it down faster.)</p>
</div>

<h2>Pictures, videos, and phone calls come from different jars</h2>
<p>Making images is paid for separately, from its own little pot of credits (a few cents per picture). <strong>Videos</strong> are the big-ticket item — roughly 50 cents to a dollar per clip — and <strong>phone calls</strong> run about a cent and a half per minute. Same idea, different jars — and the characters give you a casual heads-up before doing the expensive stuff.</p>
<p>Want to see your own numbers? Open the <strong>account menu</strong> (your avatar, bottom-left), choose <strong>Explore</strong>, then <strong>Usage &amp; Balance</strong> — it shows your balance and your month so far, item by item, nothing hidden.</p>

<h2>So why mention any of this?</h2>
<p>Not to make you feel guilty — the opposite. Kade opened this up because she wanted to share something cool with people she cares about, priced at exactly what it costs and not a penny more. Knowing how the money actually flows helps everyone trust the place… and when your balance needs feeding, the next page is <a href="/help/donate">where that happens</a>.</p>
${nextprev("tokens", "donate")}
`,
};

// ---- 8. USAGE & BALANCE (was "Feed the Server" — renamed July 16 2026) ----
PAGES.donate = {
  title: "Usage & Balance",
  h1: "Usage & Balance: Your Tab, Your Top-Ups",
  tagline: "Everything here costs exactly what it costs — no markup, no profit. This page is how the lights stay on.",
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
<p class="lead">Picture it: somewhere out there, a little server is humming along in a digital house. It's a good server. A <em>hungry</em> server. And every message you send is basically you opening its fridge. Here's how the groceries get paid for — the whole deal, in plain language.</p>

<h2>The deal (new as of July 2026)</h2>
<p>This place used to run purely on Kade's wallet and an optional tip jar. It grew — more people, more voices, phone calls, pictures, video — and the honest way to keep it alive without anybody profiting off anybody is simple:</p>
<ul>
  <li><strong>You start with $10 of credit, loaded by Kade.</strong> That's the house welcoming you in.</li>
  <li><strong>Everything you do draws from your balance at exactly what it costs.</strong> Chat is fractions of a cent. Pictures are pennies. Phone calls are about a cent and a half a minute. Video and song-making are the big spenders. No markup on any of it — the receipts on this page are the same numbers the AI providers charge Kade.</li>
  <li><strong>When your balance runs dry, things pause until you top it up.</strong> Send whatever amount through the PayPal button below — <strong>put your name in the PayPal note</strong> so Kade knows whose balance to load — and it gets added to your account, usually the same day.</li>
</ul>
<p>That's the whole model. No subscriptions, no monthly bill, no surprise charges — a prepaid tab you control completely. <strong>Kade makes zero dollars on this.</strong> The only thing your money buys is your own usage, at cost.</p>

<h2>See your own tab and balance</h2>
<p>Open the <strong>account menu</strong> (your avatar, bottom-left), choose <strong>Explore</strong>, then <strong>Usage &amp; Balance</strong>. It shows what you have left and your month so far — chat, voice, pictures, phone calls, the works — priced out honestly, item by item. No mystery meat.</p>

<h2>Topping up</h2>
<div class="btnrow">
  <a class="cta big" href="${PAYPAL_URL}">🍕 Top up your balance (PayPal)</a>
</div>
<p>Any amount works. For scale, from real usage on this site:</p>
<ul>
  <li><strong>$5</strong> — months of heavy chatting, honestly. Text conversation is nearly free.</li>
  <li><strong>$10</strong> — chatting plus a steady diet of pictures, voice calls, and check-in calls.</li>
  <li><strong>$20</strong> — the works: video calls, song-making, video clips, the expensive toys, without watching the meter.</li>
</ul>

<div class="callout good">
  <p><strong>If money's tight, say so.</strong> This whole place exists because Kade's people deserve this stuff at cost instead of Silicon Valley prices. Nobody's getting cut off from a lifeline over grocery money — if your balance is empty and your month is hard, talk to Kade. That's not charity, that's family.</p>
</div>

<div class="btnrow">
  <a class="cta" href="${PAYPAL_URL}">💛 Send a top-up</a>
  <a class="cta" href="${CHAT_URL}">← Back to chatting</a>
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

<h2>Low vision? Three switches made for you</h2>
<ul>
  <li><strong>High contrast (true black):</strong> Settings &rarr; General &rarr; Accessibility &rarr; "High contrast (true black)" &mdash; pure black background, bright white text, stronger borders. Turning it on switches you to dark mode automatically.</li>
  <li><strong>Easy-read font:</strong> same place &mdash; pick <strong>Lexend</strong> (designed for low-vision readability) or <strong>OpenDyslexic</strong> (weighted letters that resist flipping). Code and technical text stay in their normal font.</li>
  <li><strong>Line spacing:</strong> same place &mdash; Relaxed or Loose gives lines room to breathe, which often matters more than raw text size.</li>
  <li><strong>Reading view:</strong> on any AI reply, the book-icon button opens the reply full-screen in big print with nothing else on screen. Close button or Escape gets you back.</li>
</ul>

<h2>Free iPhone features that pair well with this place</h2>
<p>These are Apple features already on your phone &mdash; nothing to install, just worth knowing about:</p>
<ul>
  <li><strong>Sound Recognition</strong> (Settings &rarr; Accessibility &rarr; Sound Recognition): your iPhone listens for fire alarms, doorbells, sirens, a crying baby, and taps you with a notification. Works alongside everything here.</li>
  <li><strong>Share Accessibility Settings</strong> (iOS 26): temporarily push your exact VoiceOver, text-size, and display settings onto someone else's iPhone via AirDrop &mdash; great when you're handed a family member's phone.</li>
  <li><strong>VoiceOver Activities</strong> (iOS 26): per-app VoiceOver profiles &mdash; set a different speech rate or verbosity just for this app versus the rest of your phone.</li>
  <li><strong>Image Explorer</strong> (iOS 26): Apple's own on-device photo describing inside Photos and Safari. Handy as a quick fallback &mdash; though Describe here is conversational, remembers context, and takes follow-up questions, which Apple's can't.</li>
  <li><strong>"Hey Siri" smart-home basics:</strong> if you have any HomeKit devices, "Hey Siri, good morning" scenes and light control already work hands-free, completely separate from this site &mdash; no setup needed here.</li>
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
${nextprev("accessibility", "privacy")}
`,
};

// ---- PRIVACY & YOUR DATA ---------------------------------------------------
PAGES.privacy = {
  title: "Privacy & Your Data",
  h1: "Privacy & Your Data",
  tagline: "What gets stored, who else sees it, and how to take it all with you. In plain English.",
  main: `
<p class="lead">Kade-AI is a small, invite-only place run by one person, Kade Murdock, out of her own pocket. It is not a company and it does not make money from you. Nothing here is sold, rented, or handed to advertisers &mdash; there are no ads on this platform and no advertising or tracking code in it. This page explains, honestly, what is kept and why.</p>

<h2>The short version</h2>
<ul>
  <li>Your conversations are stored so you can come back to them. They belong to you.</li>
  <li>Nothing is sold. No ads. No advertising trackers or analytics companies.</li>
  <li>Some things you type or say are sent to outside companies that do the actual work &mdash; the AI models, the voices, the transcribing. They're listed below by name.</li>
  <li>You can download everything, any time, from your account menu.</li>
  <li>Ask Kade to delete your account and it gets deleted.</li>
</ul>

<h2>What gets stored</h2>
<p><strong>How any of it gets here.</strong> Everything below arrives one of two ways, and there is no third: you typed it, spoke it, or chose to share it &mdash; or the platform generated it while doing something you asked for, like a reply, a description, or a running cost tally. Nothing is gathered in the background, nothing is bought from anyone else, and there are no advertising or analytics trackers anywhere in the app or the site.</p>
<p><strong>Your account.</strong> Your email address, a scrambled (hashed) version of your password, your display name, and whether you're an adult or child account.</p>
<p><strong>Your conversations.</strong> Messages you send and the replies you get, so your history is there when you come back. Private chats are the exception &mdash; see <a href="/help/temporary">Starting Over &amp; Private Chats</a>.</p>
<p><strong>What it remembers about you.</strong> Memory cards and logbook entries the characters save as you talk. You can read, edit, and delete every one of these yourself &mdash; see <a href="/help/memory">What It Remembers</a>.</p>
<p><strong>Your settings.</strong> Voice picks, playback speed, notification preferences, and similar choices.</p>
<p><strong>Phone calls.</strong> If you register a phone number, that number is stored. Calls are recorded and transcribed so the character can remember the conversation, and so Kade can fix things when a call goes wrong. Every outbound call opens by telling the person they're speaking with an AI.</p>
<p><strong>Pictures, audio, and video you make.</strong> Kept in your gallery, with a written description generated for each so they're usable by ear.</p>
<p><strong>Usage and cost.</strong> A running tally of what each feature costs, per person &mdash; how many characters were spoken aloud, how many pictures made, how many call minutes. This is how the shared balance works. It records amounts, not the contents.</p>
<p><strong>Crash reports.</strong> The iPhone app sends Apple's technical crash logs to Kade's server so breakage gets found and fixed. These are stack traces and device model &mdash; not your messages.</p>
<p><strong>Location.</strong> Only if you deliberately use a feature that asks for it, like sharing where you are with a companion. It is not collected in the background, ever.</p>

<h2>Who else touches it</h2>
<p>The platform doesn't build its own AI models or voices &mdash; it rents them. That means parts of what you write or say pass through other companies to get the work done. Under their business terms these are service providers processing data on Kade-AI's behalf; they are not given your data to sell.</p>
<ul>
  <li><strong>Z.AI</strong> &mdash; the language models that write most of the replies, and the first place a message goes. It receives your message and the conversation context.</li>
  <li><strong>OpenRouter</strong> &mdash; the service the platform reaches several model companies through, and the stand-in whenever Z.AI is busy. It receives your message and the conversation context.</li>
  <li><strong>Moonshot AI</strong> &mdash; the models behind deep research and some longer thinking. They receive your message and the conversation context.</li>
  <li><strong>DeepSeek</strong> &mdash; names your conversations and helps read images. It receives the conversation being named, or the image.</li>
  <li><strong>Inworld AI and Fish Audio</strong> &mdash; text-to-speech. They receive the text being read aloud.</li>
  <li><strong>Deepgram</strong> &mdash; speech-to-text. It receives your voice audio when you talk instead of type.</li>
  <li><strong>Twilio</strong> &mdash; the phone line. It carries and records phone calls.</li>
  <li><strong>Google</strong> &mdash; describing photos and documents, the live video lane, and search inside your own memories. It receives the image, file, or video you shared.</li>
  <li><strong>fal.ai and Black Forest Labs</strong> &mdash; picture, video, and music generation. They receive your prompt.</li>
  <li><strong>Tavily</strong> &mdash; web search, when a character looks something up. It receives the search wording.</li>
  <li><strong>Railway</strong> &mdash; the servers everything runs on. <strong>Backblaze</strong> &mdash; where files and nightly backups are stored. <strong>Apple</strong> &mdash; delivers push notifications to iPhones.</li>
</ul>
<p><strong>How it reaches them.</strong> Nothing on your phone or in your browser talks to these companies directly. What you type, say, or share goes to Kade-AI's own servers first, and the server passes on only the piece each company needs for the job you asked for &mdash; the voice company gets text to read and never your photos, the picture company gets your prompt and never your call recordings. It is still your words arriving at their computers, which is why they are named here rather than described in the vague.</p>
<p><strong>What they are allowed to do with it.</strong> Every one of these companies is used under business terms that require them to protect your information at least as well as this policy promises: to process it only to deliver the feature you asked for, not to sell it, and not to use it to advertise to you. Kade-AI does not grant any of them permission to train on your conversations or to keep your data for their own purposes. If any of them ever changes those terms in a way that breaks that promise, the honest move is to drop them, and that is the intent.</p>
<p>These companies keep their own operational records under their own policies. If a feature matters to you and you'd rather it not run, don't use that feature &mdash; or say so to Kade and she'll turn it off for your account.</p>

<h2>Children's accounts</h2>
<p>Accounts for kids are set up by a parent or family administrator, never by the child. They're limited to age-appropriate content platform-wide, can't reach the open rooms, and can't place calls to numbers outside the family. A parent can read, export, or delete everything on that account by asking Kade.</p>

<h2>Getting your data, or getting rid of it</h2>
<p><strong>Download it all.</strong> Account menu &rarr; <strong>Download Your Data</strong>. You get a zip file with your conversations, memory cards, and logbook in plain readable text, plus the raw data. It's yours, it's readable in Notepad, and it doesn't ask permission.</p>
<p><strong>Delete pieces.</strong> Delete any conversation or memory card from inside the app, whenever you want.</p>
<p><strong>Delete everything.</strong> Ask Kade to close your account and it's removed. Nightly backups are kept on a rolling basis and age out on their own.</p>

<h2>Security, told straight</h2>
<p>Passwords are hashed, everything travels over encrypted connections, and access to the server is limited to Kade. It's an honestly-run small platform, not a bank &mdash; use it accordingly. Don't put anything in here you'd be harmed by losing or by someone else reading.</p>

<h2>Changes and questions</h2>
<p>If how any of this works changes, this page changes with it, and it'll show up on <a href="/help/whats-new">What's New</a>. Questions about your data go straight to <strong>Kade</strong> &mdash; there's no support department, just her.</p>

<div class="callout">
  <p><strong>The plain-language promise:</strong> your words are yours. They're kept so the characters can know you and so you can find them again, and for no other reason.</p>
</div>
${nextprev("troubleshooting", null)}
`,
};

// ---- THE ANDROID APP -------------------------------------------------------
PAGES.android = {
  title: "The Android App",
  h1: "The Android App",
  tagline: "Kade-AI as a real app on your Android phone — installed straight from this page, no app store involved.",
  main: `
<p class="lead">If you carry an Android phone, you can have Kade-AI as a real app &mdash; and as of August 28, 2026 it's a <strong>truly native app</strong>, the same breed as the iPhone one. Native chat with every companion, replies spoken in their real voices, dictation that adds to your draft instead of wiping it, your memory cards, and the whole toolbox. It follows your phone's own text size and display size settings, and the layout reflows instead of overlapping when you magnify &mdash; built low-vision-first.</p>

<p>Already have the old app? Just download and install again &mdash; the new one goes right over the top, nothing to uninstall, and you stay signed in to the same account.</p>

<p>iPhone person instead? The iPhone app comes through Apple's TestFlight and works by invitation — <strong>contact Kade</strong> and she'll add you.</p>

<p><a class="cta" href="/Kade-AI.apk" download>Download Kade-AI for Android (about 11&nbsp;MB)</a></p>

<h2>Installing it, step by step</h2>
<p>Because this app comes from Kade personally instead of the Google Play Store, Android will be a little suspicious the first time. That's normal, it's just Android being protective. Here's the whole dance:</p>
<ol>
  <li><strong>Tap the download link above</strong> on your Android phone. The file (Kade-AI.apk) lands in your Downloads.</li>
  <li><strong>Open the downloaded file.</strong> Usually there's a notification you can tap, or open your Files app and look in Downloads for "Kade-AI".</li>
  <li><strong>Android will likely say your browser "isn't allowed to install unknown apps."</strong> On that message, tap <strong>Settings</strong>, turn on <strong>Allow from this source</strong>, then go back once.</li>
  <li><strong>Tap Install.</strong> If Google Play Protect pops up warning about an app from an unknown developer, tap <strong>Install anyway</strong> — on some phones it hides behind <strong>More details</strong> first. The warning only means Google hasn't reviewed it, which is true: it comes from Kade, not Google.</li>
  <li><strong>Done.</strong> Kade-AI is in your app drawer like any other app. Sign in with the account Kade set up for you, and you're home.</li>
</ol>

<div class="callout warn">
  <p><strong>Screen reader note (TalkBack):</strong> every step above is a plainly-labeled button — nothing is hidden in gestures. The trickiest moment is the "unknown apps" screen: the switch you want is named <strong>"Allow from this source."</strong> Flip it, then use Back to return to the install screen.</p>
</div>

<h2>When there's an update</h2>
<p>Come back to this page and download again — the new version installs right over the old one. No uninstalling, no lost sign-in. When something app-worthy ships, it'll be mentioned on <a href="/help/whats-new">What's New</a>.</p>

<h2>Is this safe?</h2>
<p>Fair question — the honest answer: the app is built and signed by Kade, it simply skips the Play Store (which costs money and review time for a private family app). It only talks to <a href="${CHAT_URL}">kademurdock.com</a>, same as your browser does. If you're ever unsure a download really came from here, <strong>contact Kade</strong> before installing.</p>
${nextprev("whatsnew", "voice")}
`,
};

// ---- APK download + short link --------------------------------------------
router.get("/Kade-AI.apk", (_req, res) => {
  res.set("Content-Type", "application/vnd.android.package-archive");
  res.set("Content-Disposition", 'attachment; filename="Kade-AI.apk"');
  res.sendFile(nodePath.join(__dirname, "Kade-AI.apk"));
});
router.get("/android", (_req, res) => res.redirect(302, "/help/android"));

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
