# Character motion — Part 163

This branch advances the Part 162 cue interpreter into a reusable local playback
engine. It is a development workshop, not a production chat feature. The server
does not serve these files and no existing speech or persona path is changed.

Run `node --test avatar-expression.test.js character-motion.test.js character-player.test.js`.
Run `python -m http.server 8163 --bind 127.0.0.1`, then open
`http://127.0.0.1:8163/character-demo.html`.

## What works

- Separate Kiana and Lilly configurations use the same controller. Unknown or
  unprepared rigs stay static. No private persona, portrait URL or account record
  is included. Configuration does not grant access to an agent.
- Listening has small periodic nods, tilts and blinks. Thinking has blinks only.
  These are authored gestures, not semantic interpretation of a user's speech.
- A decoded AudioBuffer yields bounded 20 ms RMS windows. The mouth follows those
  windows against the actual scheduled playback start, and closes in silence.
  Stereo uses maximum channel energy, avoiding phase cancellation. It is
  audio-driven mouth opening, not phoneme or viseme lip sync.
- Audio-relative cue timestamps change expressions when the audio reaches them.
  Persistent directions survive later clips; temporary reactions return to the
  prior expression. Text offsets are never interpreted as audio timestamps.
- Unique turn tokens reject old completions, interrupts and schedules even when
  the same character speaks twice. Switching characters invalidates the old turn.
- Motion begins off. Off, reduced motion and hidden views stop the frame loop.
  Resuming catches up without replaying missed gestures or reactions. Animation
  failures cannot throw into audio scheduling. The controller never owns audio.
- Decorative SVG/readouts are aria-hidden. Labels, keyboard controls, transcript
  and written appearance/motion descriptions remain available without sight.

The bundled WAV was generated locally with Windows System.Speech. It is a neutral
test voice reading the exact displayed transcript, not Kiana or Lilly. No paid
model, TTS, image or GPU request was used. The demo can also read a local audio file
without uploading it. It rejects files above 20 MB and decoded audio over 2 minutes.

## Integration contract

`CharacterMotion.create(profile)` is client-neutral state. `CharacterPlayer.create`
adds an injected clock, renderer and frame scheduler. Use the existing playback
AudioContext's clock. Observe a decoded buffer; never reconnect the sound graph
just to animate. `speak()` returns a unique token. `schedule(token, {start,
duration, envelope, cues, speech})` accepts ordered, non-overlapping segments;
each cue is `{at: secondsWithinThisClip, tag: canonicalDirection}`. Non-speech
sound effects use `speech:false`. Call `interrupt(token)` when audio is cancelled
and `finish(token)` after the whole reply drains, not after its first clip.

Production renderer should reveal the existing static portrait if rig assets
fail to load. Renderer/config/queue work must stay inside a fail-soft boundary.
Store a user preference through the existing settings mechanism; this workshop
deliberately does not persist or modify account preferences. Real rendering may
need output-latency compensation on Bluetooth, and device acceptance remains owed.

## Actual web seams inspected at fork 6e88f62

1. `client/src/components/Chat/ConversationMode.tsx`, `enqueueAudio`: the decoded
   buffer and `src.start()` are the correct playback seam. Carry metadata beside
   the audio promise, not in caption effects. The output analyser also receives
   game cues, so its energy alone is insufficient to identify speech.
2. `client/src/components/Chat/useStreamingCall.ts`, `enqueueWav` and
   `enqueueLivePcm`: both already have the AudioBuffer and scheduled start `t`.
   Preserve `flushSeqRef`, `nextTimeRef` and existing onended bookkeeping. Report
   those exact segments to the presentation layer only after scheduling succeeds.
3. Streaming control messages/captions do not provide per-direction audio offsets.
   Audio-driven mouth movement can use the existing buffer immediately; accurate
   expression changes within a clip need provider/bridge cue metadata. Do not
   fake that alignment from character counts or change TTS chunking to obtain it.
4. Use the active agent's authorized profile after speaker changes, and forward
   clear/end/error/navigation to animation cancellation. Preserve the existing
   call dialog's focus management and silent-during-speech status behavior.

## Verification and limits

23 focused Node tests pass, including cancellation ownership, out-of-order cues,
stereo energy, silent clips, missing metadata, queue bounds and frame cleanup.
Edge played the actual WAV; sampled frames included open-mouth speech and a
closed mouth while audio was still playing. Browser checks cover interruption,
Lilly configuration, reduced motion, unknown-character fallback, 1040px light and
360px dark layouts, no horizontal overflow, and zero external network requests.
The first browser run found a select overflow at 360px; the select width was fixed
and the full browser check passed. Screenshots were inspected.

This does not establish final portrait quality, frame-perfect hardware output
latency, phoneme lip sync, battery cost, screen-reader/device acceptance or native
integration. Neither the fork nor any native app changed. The schematic drawing
must not replace a character's real portrait. Final rigs/portrait expressions and
live client adapters are the next build step. Forge can read and continue the
branch using his existing repository tools.
