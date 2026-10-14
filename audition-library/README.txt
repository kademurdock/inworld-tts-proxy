Audition scripts

Six banks add 552 original scenes to the 48 in audition-scenes.js.
Every scene has a full monologue and a short preview: 600 scenes, 1,200 scripts.
Kids, Characters and Adults each have 100 conversations and 100 book passages.
The short previews are excerpts, not additional story premises.

Each text file has 92 lines in feeling|monologue format. The loader checks the
file size and format and derives a one- or two-sentence preview under the
existing 160-character limit. Full readings have at least three sentences.
Delivery markers go through the platform's existing Drama3 speech adapter.

Selection uses six shuffled bags, one per audience and length, shared across
voices in the running service. Each bag uses all 200 scripts before reshuffling
and avoids repeating the last script at the cycle boundary. Bags reset on a
service restart and are independent across service instances. This does not
change normal chat speech or retained legacy voice bindings.

Run node --test audition-scenes.test.js audition-scenes.wire.test.js to verify
content counts, category routing, cycling and actual audition request handling.
