"use strict";
/**
 * lab.js — THE LISTENING LAB (Part 118, Sep 2 2026)
 *
 * GET /lab/limiter. Her ear is the only instrument that can hear "a little
 * buzz every now and then"; the numbers say where it is not. So instead of a
 * session guessing at the output stage from a spectrum, this page renders the
 * SAME words on the SAME voice through four named variants of the output
 * stage (server.js TTS_LAB_PRESETS, `/v1/audio/speech?lab=<name>`) and lets
 * her pick on her own phone. Same origin, so the audio plays here without
 * CORS. Blind-first: headings, real buttons, one live region that says what
 * is happening, no visuals that carry meaning. Each press costs one synth
 * (Inworld: fractions of a cent; a fish clone: about a cent).
 */
// No express import here on purpose: the test file requires this module in a
// checkout without node_modules. server.js hands us the app.

const PRESETS = [
  { key: "live", letter: "A", label: "As it is now", blurb: "The live setting. Peaks may land four decibels over the ceiling before the limiter pulls them down, and the tone match may boost or cut bass and treble toward the reference when a voice sits far from it." },
  { key: "gentler", letter: "B", label: "Gentler limiter", blurb: "Same as A, except peaks may land only three decibels over the ceiling, so no syllable is ever pulled down more than three. About one decibel quieter on the peakiest voices, unchanged on the rest." },
  { key: "lean", letter: "C", label: "Lean tone", blurb: "Same as A, except the tone match only ever cuts, never boosts bass or treble, and anything under eighty hertz is filtered out before the loudness stage. Built for phone speakers, which turn deep bass into buzz." },
  { key: "loud", letter: "D", label: "Louder", blurb: "Same as A with the loudness target one decibel hotter. The limiter works harder for it, so if there is a buzz in A, D should make it worse; if D sounds fine, the buzz is not the limiter." },
];

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function mountLab(app) {
  app.get("/lab/limiter", (_req, res) => {
  const buttons = PRESETS.map((p) => `
      <section aria-labelledby="h-${p.key}">
        <h2 id="h-${p.key}">${p.letter}. ${esc(p.label)}</h2>
        <p>${esc(p.blurb)}</p>
        <button type="button" data-preset="${p.key}" data-letter="${p.letter}">Play ${p.letter}</button>
        <audio id="audio-${p.key}" controls preload="none" aria-label="Clip ${p.letter}, ${esc(p.label)}"></audio>
      </section>`).join("\n");
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Listening lab — the output stage</title>
<style>
  body { font: 18px/1.5 system-ui, sans-serif; margin: 0; padding: 1rem; max-width: 42rem; margin-inline: auto; color: #111; background: #fff; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 1.5rem; }
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input, textarea, button { font: inherit; }
  input, textarea { width: 100%; box-sizing: border-box; padding: .5rem; border: 2px solid #444; border-radius: 6px; }
  textarea { min-height: 7rem; }
  button { padding: .7rem 1.2rem; border: 2px solid #222; border-radius: 8px; background: #222; color: #fff; margin: .5rem .5rem .5rem 0; min-width: 8rem; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid #0a58ca; outline-offset: 2px; }
  audio { display: block; width: 100%; margin-top: .5rem; }
  #status { border-left: 4px solid #0a58ca; padding: .5rem .75rem; margin-top: 1rem; background: #f3f6fb; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #111; } button { background: #eee; color: #111; border-color: #eee; } #status { background: #1c2333; } input, textarea { background: #1a1a1a; color: #eee; border-color: #888; } }
</style>
</head>
<body>
<main>
  <h1>Listening lab: the voice output stage</h1>
  <p>Same words, same voice, four versions of the loudness and tone stage. Pick a voice, keep or change the words, then play A, B, C and D and tell Kade which one sounds cleanest and loud enough. Each play makes a fresh clip, so the delivery will vary a little between presses; the thing to listen for is buzz, crackle, or a hot-mic edge on the loudest syllables.</p>
  <form id="f" onsubmit="return false">
    <label for="voice">Voice label (for example, Voice 69 or Voice 400)</label>
    <input id="voice" name="voice" value="Voice 69" autocomplete="off">
    <label for="text">Words to say</label>
    <textarea id="text" name="text">[warm] Well, look who finally showed up. I made coffee an hour ago and it has been sitting there getting cold and judging me. Sit down, tell me what happened with the car, and do not skip the part where you argued with the mechanic.</textarea>
  </form>
  <div id="status" role="status" aria-live="polite">Ready. Pick a version below and press its Play button.</div>
${buttons}
  <h2>What the letters change</h2>
  <p>B, C and D each change exactly one thing from A, so whichever one sounds different tells Kade where the buzz lives. The limiter is the last thing every clip passes through. It looks a few milliseconds ahead and turns the whole clip down briefly whenever a peak would cross the ceiling. The overdrive number is how far over the ceiling the raw peaks are allowed to land before that happens, which is also the most any one syllable can be pulled down. The tone match measures every clip in three bands and nudges the bass and treble shelves toward the sound of the Inworld voices you already know. C turns the boosting half of that off and adds a rumble filter, which is the version to try if the buzz lives on your phone speaker and not in your headphones.</p>
  <p><a href="/help/voice">Back to Talking and Listening</a></p>
</main>
<script>
(function () {
  const status = document.getElementById("status");
  const say = (m) => { status.textContent = m; };
  document.querySelectorAll("button[data-preset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const preset = btn.dataset.preset, letter = btn.dataset.letter;
      const voice = document.getElementById("voice").value.trim() || "Voice 69";
      const text = document.getElementById("text").value.trim();
      const audio = document.getElementById("audio-" + preset);
      btn.disabled = true;
      say("Making clip " + letter + " on " + voice + ". This takes a few seconds.");
      try {
        const r = await fetch("/v1/audio/speech?lab=" + encodeURIComponent(preset), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: text, voice: voice, model: "tts-1", response_format: "wav" }),
        });
        if (!r.ok) { say("Clip " + letter + " failed: " + r.status + " " + r.statusText); btn.disabled = false; return; }
        const blob = await r.blob();
        if (audio.src) URL.revokeObjectURL(audio.src);
        audio.src = URL.createObjectURL(blob);
        say("Clip " + letter + " is ready and playing.");
        try { await audio.play(); } catch (_e) { say("Clip " + letter + " is ready. Press play on its player."); }
      } catch (e) {
        say("Clip " + letter + " failed: " + (e && e.message ? e.message : e));
      }
      btn.disabled = false;
    });
  });
})();
</script>
</body>
</html>`);
  });
}

module.exports = mountLab;
module.exports.PRESETS = PRESETS;
