# Expression cues prototype — Part 162

This is an unshipped, client-neutral motion prototype, not Kiana's final artwork
and not wired into speech or any web/native client. No provider call or GPU
endpoint is created by it. Run `node --test avatar-expression.test.js`.

`timeline(speechReadyText)` finds canonical `%%%direction%%%` markers and retains
UTF-16 source offsets. Input must be final speech-ready text, after the normal
code/artifact filtering. It is NOT an incremental raw chat parser. A caller must
buffer incomplete markers across chunks before using it. It does not mutate text.

`controller()` keeps each playback's persistent direction separate from one-shot
reactions. Start with a unique playback ID, apply tags as their associated audio
segment starts playing, and use the returned revision with `endMoment(id, revision)`.
Stop/reset on cancellation, finish, speaker change or navigation. Late callbacks
from old playback IDs or old one-shots cannot overwrite newer expressions.
Known speech sounds without a visual mapping preserve the underlying expression.

The interpretation is deliberately simple and incomplete. It handles selected
feeling words and exact canonical sounds; uncertain/negated directions fall back
to neutral. Speech tags are performance instructions, not proof of emotion. Do not
silently label user emotions or add a classifier/LLM call.

## Integration work still required

1. Artist-approved layered face rig or cached expression assets per character;
   preserve the existing portrait as a fallback. The demonstration drawing is a
   schematic, not replacement art.
2. Client opt-in and motion/off setting. Respect system reduced motion and battery
   constraints. Pause hidden views. The decorative face is aria-hidden and does
   not interrupt or duplicate spoken chat; all meaningful content stays in text.
3. Attach cues to the existing playback queue's IDs and audio segment boundaries.
   Text offsets are NOT audio timestamps. Native and browser segmenters need real
   mapping/ownership tests. A volume-driven mouth is approximate mouth motion,
   not phoneme lip sync. Do not claim synchronized speech until tested on devices.
4. Unknown agents use their static portrait; only visible active speakers animate.
   Cues must never delay, cancel or otherwise own TTS. No remote video service is
   needed for cached expressions or a local 2D rig.

The Codex motion study exercises expression selection, temporary gasp/return,
simulated speaking and reduced-motion behavior. It has no audio or live chat
connection. Five module tests and Edge checks at 736px light/360px dark pass.

Research and session results: `CHARACTER_ANIMATION_OPTIONS_2026-09-08.md` and
`KIANA_ANIMATION_AND_MODEL_REVIEW_2026-09-08_PART162.md` in the project memory repo.
No Scenema resource was changed or deleted. The standing $1 test authorization
covered conversation experiments only, not asset generation or new GPU service.
