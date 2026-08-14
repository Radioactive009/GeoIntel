"""
Spoken answers.

The browser's own speech synthesis is free, offline and universal, and it is
what this falls back to. It also sounds like a machine reading a label, which
is the problem this module exists to solve.

Groq hosts Orpheus, which sounds like a person and takes bracketed vocal
directions — "[gravely]", "[warmly]" — so the delivery can follow what is
actually being said. That is the whole point: a casualty figure and a
ceasefire should not be read in the same cheerful monotone.

Two constraints shape everything here. Orpheus accepts about 200 characters
per request, so anything longer has to be split and the returned audio
stitched back together. And it is billed per character, unlike everything
else this project uses — which is why it is off unless deliberately switched
on, and why the amount of text that can reach it is capped rather than
trusted.
"""

from __future__ import annotations

import io
import logging
import os
import re
import wave

import requests
from sqlalchemy.orm import Session

from . import tone as tone_service
from .agent import _budget_state, _record_request, DAILY_BUDGET, api_key

logger = logging.getLogger(__name__)

SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech"

TTS_MODEL = os.getenv("TTS_MODEL", "canopylabs/orpheus-v1-english")

# One of Groq's Orpheus personas. The model rejects an unknown name outright
# rather than substituting one, so a typo here surfaces as a clear API error
# rather than an unexpected voice.
TTS_VOICE = os.getenv("TTS_VOICE", "troy")

# Off unless switched on. Every other service this project calls is free at
# the volumes involved; this one is not, and a voice endpoint left open on a
# public site is a bill rather than a feature.
TTS_ENABLED = os.getenv("TTS_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}

# Groq documents roughly 200 characters per request for this model.
MAX_CHUNK_CHARS = 200

# Bounds both cost and latency: chunks are synthesised in order, so a long
# answer would otherwise be several sequential round trips before the first
# sound. Longer answers are spoken up to this point and left there — the full
# text is on screen regardless.
MAX_TEXT_CHARS = 600

REQUEST_TIMEOUT = 45

# Bracketed vocal directions, per Groq's guidance that one or two words work
# best and that no direction at all yields natural conversational speech —
# which is why neutral gets none rather than something like "[normal]".
DIRECTIONS = {
    tone_service.UPLIFTING: "[warmly]",
    tone_service.SERIOUS: "[gravely]",
    tone_service.NEUTRAL: "",
}

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def is_available() -> bool:
    return bool(TTS_ENABLED and api_key())


def direction_for(text: str) -> str:
    """Pick a vocal direction from what the answer actually says.

    Reuses the article tone classifier rather than a second vocabulary: it
    already distinguishes harm from good news across this project's subject
    matter, and a spoken answer is drawn from the same archive.
    """
    label, _ = tone_service.classify_tone(text, "", "")
    return DIRECTIONS.get(label, "")


def chunk(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split text into pieces the model will accept, preferring sentences.

    Sentence boundaries first, because a break mid-clause is audible as a
    swallowed word once the pieces are stitched. A sentence longer than the
    limit is split on commas and then on whitespace; a single word longer
    than the limit is cut, which is not worth avoiding for real prose.
    """
    text = " ".join((text or "").split())
    if not text:
        return []

    pieces: list[str] = []
    for sentence in _SENTENCE_END.split(text):
        if not sentence:
            continue
        if len(sentence) <= limit:
            pieces.append(sentence)
            continue
        # Too long to speak in one request: break it down further.
        buffer = ""
        for part in re.split(r"(?<=,)\s+|\s+", sentence):
            candidate = f"{buffer} {part}".strip()
            if len(candidate) <= limit:
                buffer = candidate
            else:
                if buffer:
                    pieces.append(buffer)
                buffer = part[:limit]
        if buffer:
            pieces.append(buffer)

    # Pack neighbouring sentences together: fewer requests is less latency and
    # fewer seams, and the limit is per request rather than per sentence.
    packed: list[str] = []
    for piece in pieces:
        if packed and len(packed[-1]) + 1 + len(piece) <= limit:
            packed[-1] = f"{packed[-1]} {piece}"
        else:
            packed.append(piece)
    return packed


def _synthesise_one(text: str, voice: str) -> bytes:
    """One request to Groq. Raises on anything that is not audio."""
    response = requests.post(
        SPEECH_URL,
        headers={"Authorization": f"Bearer {api_key()}"},
        json={
            "model": TTS_MODEL,
            "input": text,
            "voice": voice,
            "response_format": "wav",
        },
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"{response.status_code}: {response.text[:300]}")
    return response.content


def _stitch(clips: list[bytes]) -> bytes:
    """Join WAV clips into one.

    Concatenating the bytes directly would embed a 44-byte header in the
    middle of the audio, which plays as a click and leaves the total duration
    wrong in the leading header. The frames have to be unpacked and rewritten.
    """
    if len(clips) == 1:
        return clips[0]

    frames: list[bytes] = []
    params = None
    for clip in clips:
        with wave.open(io.BytesIO(clip), "rb") as source:
            if params is None:
                params = source.getparams()
            elif (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (
                params.nchannels, params.sampwidth, params.framerate
            ):
                # Same model and voice throughout, so this should not happen;
                # returning the first clip beats emitting garbled audio.
                logger.warning("speech: clip format changed mid-answer, truncating")
                break
            frames.append(source.readframes(source.getnframes()))

    out = io.BytesIO()
    with wave.open(out, "wb") as sink:
        sink.setparams(params)
        for frame in frames:
            sink.writeframes(frame)
    return out.getvalue()


def synthesise(db: Session, text: str, voice: str | None = None) -> dict:
    """Speak `text`, returning WAV bytes or an error to show the caller.

    Never raises: the interface falls back to browser synthesis on any error,
    so a failure here should cost a plainer voice and nothing else.
    """
    text = (text or "").strip()
    if not text:
        return {"audio": None, "error": "Nothing to speak."}
    if not TTS_ENABLED:
        return {"audio": None, "error": "Server speech is disabled."}
    if not api_key():
        return {"audio": None, "error": "Speech is not configured on this server."}

    _, used = _budget_state(db)
    if DAILY_BUDGET and used >= DAILY_BUDGET:
        return {"audio": None, "error": "The daily limit has been reached."}

    spoken = text[:MAX_TEXT_CHARS]
    prefix = direction_for(spoken)
    pieces = chunk(spoken)
    if not pieces:
        return {"audio": None, "error": "Nothing to speak."}

    clips: list[bytes] = []
    for piece in pieces:
        # The direction goes on every request: it steers one utterance, and
        # applying it only to the first would drift back to flat delivery
        # partway through the answer.
        payload = f"{prefix} {piece}".strip() if prefix else piece
        try:
            clips.append(_synthesise_one(payload, voice or TTS_VOICE))
        except requests.RequestException as exc:
            logger.warning("speech: request failed: %s", exc)
            break
        except RuntimeError as exc:
            message = str(exc)
            if "model_terms_required" in message or "terms acceptance" in message:
                return {
                    "audio": None,
                    "error": (
                        "The speech model needs its terms accepted once at "
                        "console.groq.com before it can be used."
                    ),
                }
            if message.startswith("401"):
                return {"audio": None, "error": "The speech API key was rejected."}
            logger.warning("speech: %s", message)
            break
        _record_request(db)

    if not clips:
        return {"audio": None, "error": "Speech synthesis failed."}

    try:
        return {"audio": _stitch(clips), "error": None}
    except (wave.Error, EOFError) as exc:
        logger.warning("speech: could not stitch clips: %s", exc)
        return {"audio": clips[0], "error": None}
