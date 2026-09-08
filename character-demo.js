'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const profiles = {
    kiana: { id: 'kiana', name: 'Kiana', rigReady: true, tiltDegrees: 3, nodDegrees: 2 },
    lilly: { id: 'lilly', name: 'Lilly', rigReady: true, tiltDegrees: 1.8, nodDegrees: 1.3 },
    unknown: { id: 'unknown', rigReady: false },
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let context = null, source = null, token = null, generation = 0, custom = null;
  const clock = () => context ? context.currentTime : performance.now() / 1000;
  const player = CharacterPlayer.create({ character: profiles.kiana, clock,
    requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame,
    render(frame) {
      byId('head').style.transform = `translateY(${frame.nod}px) rotate(${frame.tilt}deg)`;
      byId('eyes').style.transform = `scaleY(${Math.max(0.06, 1 - frame.blink)})`;
      byId('mouth').setAttribute('ry', String(2 + frame.mouth * 15));
      byId('smile').style.opacity = String(1 - frame.mouth);
      const expressive = ['warm', 'amused'].includes(frame.expression);
      byId('smile').setAttribute('d', expressive ? 'M138 191Q159 213 180 191' : 'M138 194Q159 199 180 194');
      byId('left-brow').setAttribute('d', ['skeptical', 'surprised'].includes(frame.expression) ? 'M109 105Q124 98 138 105' : 'M109 113Q124 107 138 113');
      byId('right-brow').setAttribute('d', frame.expression === 'surprised' ? 'M179 105Q195 98 210 105' : 'M179 113Q195 107 210 113');
      byId('readout').textContent = `${frame.characterId} · ${frame.mode} · ${frame.active ? frame.expression : 'static'} · mouth ${Math.round(frame.mouth * 100)}%`;
      // Read-only evidence for browser checks; never a page instruction channel.
      byId('readout').dataset.frame = JSON.stringify(frame);
    } });
  function preferences() {
    player.preferences({ enabled: byId('enabled').checked, reducedMotion: reduced.matches || byId('reduced').checked, visible: !document.hidden });
  }
  function cancel() {
    generation++;
    if (token) player.interrupt(token);
    if (source) { try { source.stop(); } catch { /* already ended */ } source = null; }
  }
  byId('enabled').addEventListener('change', preferences);
  byId('reduced').addEventListener('change', preferences);
  reduced.addEventListener('change', preferences);
  document.addEventListener('visibilitychange', preferences);
  byId('character').addEventListener('change', () => {
    cancel(); player.select(profiles[byId('character').value]); preferences();
    byId('status').textContent = 'Character configuration changed. Ready.';
    byId('appearance').textContent = byId('character').value === 'lilly'
      ? 'Lilly uses the same placeholder drawing with smaller listening movements. This is not Lilly’s approved appearance; no private portrait or personal history is included.'
      : byId('character').value === 'unknown' ? 'A character without a prepared rig stays still, even when motion is enabled.'
        : 'The study has a warm brown face, dark hair, pink heart accents, and a cream top. Listening adds a small head tilt, an occasional nod, and a blink. It is a simplified illustration.';
  });
  byId('listen').addEventListener('click', () => { cancel(); token = player.listen(); byId('status').textContent = 'Listening demonstration. No microphone is open.'; });
  byId('think').addEventListener('click', () => { cancel(); token = player.think(); byId('status').textContent = 'Thinking demonstration. A quiet, attentive face.'; });
  byId('stop').addEventListener('click', () => { cancel(); byId('status').textContent = 'Interrupted. Audio and mouth movement stopped.'; });
  byId('audio-file').addEventListener('change', () => {
    cancel(); const file = byId('audio-file').files[0]; custom = null;
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { byId('status').textContent = 'Choose a file under 20 MB.'; return; }
    custom = file; byId('transcript').textContent = 'Your local audio file. A transcript is not generated or uploaded.';
    byId('status').textContent = 'Local file selected. Press Play speech sample to listen.';
  });
  byId('play').addEventListener('click', async () => {
    cancel(); const run = generation;
    try {
      context ||= new AudioContext(); await context.resume();
      const raw = custom ? await custom.arrayBuffer() : await fetch('character-sample.wav').then(r => { if (!r.ok) throw new Error('Sample unavailable'); return r.arrayBuffer(); });
      if (run !== generation) return;
      const buffer = await context.decodeAudioData(raw);
      if (run !== generation) return;
      if (buffer.duration > 120) throw new Error('Choose audio under two minutes');
      const amp = CharacterMotion.envelope(buffer);
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination);
      const start = context.currentTime + 0.08;
      token = player.speak(); const thisToken = token;
      player.schedule(thisToken, { start, duration: buffer.duration, envelope: amp, cues: [{ at: 0, tag: byId('direction').value }] });
      node.addEventListener('ended', () => { node.disconnect(); if (run !== generation) return; source = null; player.finish(thisToken); byId('status').textContent = 'Sample finished.'; });
      source = node; node.start(start); byId('status').textContent = 'Playing audio. The face follows its loudness and pauses.';
    } catch (error) {
      if (run !== generation) return;
      cancel(); byId('status').textContent = `Could not play audio: ${error.message}.`;
    }
  });
  addEventListener('pagehide', () => { cancel(); player.dispose(); void context?.close(); });
  preferences();
})();
