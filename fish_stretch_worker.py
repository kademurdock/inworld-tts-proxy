"""Praat's overlap-add for Fish chat speech: one long-lived process, owned by fish-stretch.js.

Oct 30 2026, Kade, comparing one take through several methods: "Grat is my favorite ... Grat
actually sounded really naturally." praat() below is the exact recipe she heard; do not improve it.

Little-endian frames over stdin and stdout, one clip at a time:
  request   id u32, ratio f64, sample rate u32, byte count u32, s16 mono PCM
  reply     id u32, status u32, byte count u32, s16 mono PCM
A reply with id 0 and status 0 says the imports are done and clips can come. A clip that fails
gets a nonzero status and no audio, and the worker carries on. A frame it cannot trust means the
stream cannot be trusted either, so it exits and fish-stretch.js starts another. End of input is
the normal way out: the server went away. Nothing is ever printed about what is being said; this
process only ever sees audio.
"""
import os
import struct
import sys

REQUEST = struct.Struct("<IdII")
REPLY = struct.Struct("<III")
OK, BAD_CLIP, PRAAT_FAILED = 0, 1, 2
MAX_BYTES = 32 * 1024 * 1024  # fish-stretch.js sends far less; past this the frame itself is wrong


def read_exactly(stream, count):
    data = stream.read(count)
    return data if data is not None and len(data) == count else None


def praat(x, sr, speed):
    snd = parselmouth.Sound(x, sampling_frequency=sr)
    m = call(snd, "To Manipulation", 0.01, 75, 600)
    tier = call(m, "Extract duration tier")
    call(tier, "Add point", 0.0, 1 / speed)
    call([tier, m], "Replace duration tier")
    return call(m, "Get resynthesis (overlap-add)").values[0]


def stretch(pcm, ratio, sample_rate):
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768.0
    y = np.nan_to_num(np.asarray(praat(x, sample_rate, ratio), dtype=np.float64))
    # The same peak rule as the files she judged: a peak over 0.99 turns the whole clip down.
    peak = float(np.abs(y).max()) if y.size else 0.0
    if peak > 0.99:
        y = y * 0.99 / peak
    return np.clip(np.rint(y * 32768.0), -32768, 32767).astype("<i2").tobytes()


def main():
    stdin = sys.stdin.buffer
    # Only the protocol may reach the real stdout; anything a library prints goes to stderr.
    stdout = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)

    def send(clip_id, status, pcm=b""):
        stdout.write(REPLY.pack(clip_id, status, len(pcm)))
        stdout.write(pcm)
        stdout.flush()

    send(0, OK)
    while True:
        head = read_exactly(stdin, REQUEST.size)
        if head is None:
            return 0
        clip_id, ratio, sample_rate, count = REQUEST.unpack(head)
        if count > MAX_BYTES or count % 2:
            return 2
        pcm = read_exactly(stdin, count)
        if pcm is None:
            return 0
        if not (0.25 <= ratio <= 4 and 8000 <= sample_rate <= 192000 and count):
            send(clip_id, BAD_CLIP)
            continue
        try:
            out = stretch(pcm, ratio, sample_rate)
        except Exception:
            send(clip_id, PRAAT_FAILED)
            continue
        send(clip_id, OK, out)


if __name__ == "__main__":
    # Imported here so a broken install exits before the ready frame instead of claiming to work.
    import numpy as np
    import parselmouth
    from parselmouth.praat import call
    sys.exit(main())
