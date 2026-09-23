# Voice delivery: provider behavior and platform decisions

Reviewed against official documentation September 23, 2026. This file supersedes dated explanatory comments when they describe an older provider behavior. The implementation and request receipts remain the evidence for what actually runs.

## Inworld

The platform requests `inworld-tts-2`, which supports natural-language delivery instructions. Its `temperature` field is ignored; `deliveryMode` is the control for variability. Lively maps to `CREATIVE`, Balanced to `BALANCED`, and Steady to `STABLE`. Lively is our default after Kade preferred its engagement over the Balanced trial. A saved client choice wins. Speed remains a separate setting. Flash does not support delivery steering, so changing to Flash would lose a capability this platform needs.

A direction lasts until replaced or reset; punctuation, paragraph breaks, and sound events do not end it. We lift the opening direction into `instruction`, retain actual mid-text changes inline, and repeat the current instruction only when we create a separate provider request. Inworld prefers one mechanism per request; mixing the field and inline tags is nevertheless explicitly defined. Our mixed use preserves existing authored changes without extra splits or rewriting speech. Do not add a direction to every sentence.

`synthesisContext.previousRequests` supplies previous synthesized **text**, in order. It is not billed, and has a 2,000-character total limit. We keep at most three recent pieces within 1,900 characters for 90 seconds. Cross-request context is scoped to seat and resolved voice, previews never read or write it, and a request takes a fixed snapshot. Completion order cannot reverse the history. Failed requests are not remembered. Overlapping prefetches may lack a still-in-flight predecessor; this cache does not supply user audio or a full conversation. Old clients do not send a conversation ID, so the same voice on one seat may still share recent context across chats within the expiry window.

The clone/reference strongly affects habitual delivery. Lively permits variation; it does not by itself understand why a line should sound relieved, skeptical, or affectionate. Authored directions should describe the speaker's attitude toward the actual words. Emotional warmth does not require whispering, and excitement does not require shouting. Keep explicit performance requests possible. Cloning guidance differs between instant and professional clones; do not replace a person's chosen voice as a tuning shortcut.

Sources: [steering](https://docs.inworld.ai/tts/capabilities/steering), [streaming API and context limits](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-stream), [natural speech](https://docs.inworld.ai/tts/best-practices/generating-speech), [LLM prompting](https://docs.inworld.ai/tts/best-practices/prompting-for-tts-2), [cloning](https://docs.inworld.ai/tts/best-practices/voice-cloning), [release history](https://docs.inworld.ai/release-notes/tts).

## Fish Audio

The production model remains `s2.1-pro`, selected in the HTTP `model` header. S2 understands free-form bracket descriptions learned from training; these are not a guaranteed finite command language. S1's parenthesis dialect is different. Use sparse, compatible descriptions close to the affected words. Keep sounds separate from persistent attitude; avoid repeated cue resets and contradictory combinations.

Current production defaults: temperature 0.9, top-p 0.85, normal latency, source speed 1.0, and our existing text normalization before synthesis. Explicit delivery maps Steady/Balanced/Lively to 0.5/0.9/1.0. Fish's latency value named `balanced` is a speed/quality setting, unrelated to our Delivery picker. Keep normal latency for the quality baseline. Per-sentence reseeding stays off. The one-paragraph request boundary and bounded sentence pauses remain because earlier platform trials found repeated/gibberish output with joined paragraphs; this session fixes lost directions without discarding that evidence.

The API documents `condition_on_previous_chunks` (default true) for audio continuity **inside a request**. It is not a previous-conversation-text field. Do not prepend earlier dialogue to Fish's `text`: it would be spoken again. The current separate HTTP requests cannot share that internal audio state. Longer requests or WebSocket contexts need fresh fidelity and latency trials before replacing the measured short-request path. No experimental model, quality-guard flag, or new paid voice training was enabled.

Fish's API schema currently says normal latency and chunk length 300 are defaults, while its prose guide gives balanced and 200. We explicitly send normal latency and treat the API schema/request receipts as authoritative. Its model overview describes broader S2 language support than the older emotion reference. Do not copy S1 examples or stale comments into S2 wiring. Old comments claiming a guaranteed sentence-only cue scope or a currently expired free tier are historical, not current provider contracts.

Sources: [models and S2 controls](https://docs.fish.audio/developer-guide/models-pricing/models-overview), [emotion guidance](https://docs.fish.audio/developer-guide/core-features/emotions), [TTS API schema](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech), [TTS guide](https://docs.fish.audio/features/text-to-speech), [clone recording](https://docs.fish.audio/developer-guide/best-practices/voice-cloning), [pricing](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits).

## Verification and limits

Regression cases must include a mid-piece change, inline reset, one-shot sound, long paragraph, different seat/voice, preview, overlapping calls, and an explicit delivery override. The iPhone and live-call splitters also track the final authored direction, not only the opening one. Their carry limits remain intact. Android already scans all authored tags when carrying between chunks.

Audio trials use identical scripts on both providers at Balanced and Lively. Check words through transcription and inspect audio boundaries/levels; neither test proves that emotion sounds appropriate. Listening remains the acceptance check for warmth, identity, and naturalness. TestFlight compilation also does not prove phone playback. Existing cached/downloaded recordings retain their original performance; fresh synthesis uses the corrections.

Jev can classify text or review a proposed wording change. It does not hear this audio and must not be presented as an acoustic emotion judge.
