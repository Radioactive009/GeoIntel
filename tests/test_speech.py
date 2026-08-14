"""
Spoken answers.

Groq is stubbed throughout. What matters is that the only billed call in the
project cannot be run up by a long answer, cannot be reached when switched
off, and degrades to the browser's own voice rather than to silence.
"""

import io
import wave

import pytest
import requests

from app.services import speech, tone as tone_service


def _wav(frames: int = 800, rate: int = 24000) -> bytes:
    """A valid mono WAV of `frames` samples, as the API would return."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x01" * frames)
    return buffer.getvalue()


def _streaming_wav(frames: int = 800, rate: int = 24000) -> bytes:
    """A WAV shaped the way Groq actually returns them.

    Its responses are streamed, so the length is unknown when the header goes
    out and both the RIFF and data chunk sizes are sent as 0xFFFFFFFF. The
    audio is fine; every size field in it is a lie. Generated fixtures were
    well-formed and hid a crash that only appeared against the real API.
    """
    body = _wav(frames, rate)
    patched = bytearray(body)
    patched[4:8] = (0xFFFFFFFF).to_bytes(4, "little")        # RIFF size
    index = patched.find(b"data")
    patched[index + 4:index + 8] = (0xFFFFFFFF).to_bytes(4, "little")
    return bytes(patched)


def _frames(payload: bytes) -> int:
    """Real frame count, measured rather than taken from the header."""
    with wave.open(io.BytesIO(payload), "rb") as handle:
        total = 0
        while True:
            block = handle.readframes(4096)
            if not block:
                return total
            total += len(block) // (handle.getnchannels() * handle.getsampwidth())


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(speech, "TTS_ENABLED", True)
    monkeypatch.setenv("GROQ_API_KEY", "test-key")


class _Reply:
    def __init__(self, status=200, content=b"", text=""):
        self.status_code = status
        self.content = content
        self.text = text


class TestChunking:
    """Orpheus takes ~200 characters, so everything longer has to be split."""

    def test_short_text_is_one_piece(self):
        assert speech.chunk("A short sentence.") == ["A short sentence."]

    def test_every_piece_is_within_the_limit(self):
        text = " ".join(f"Sentence number {i} about the situation." for i in range(40))
        pieces = speech.chunk(text)
        assert pieces
        assert all(len(p) <= speech.MAX_CHUNK_CHARS for p in pieces), \
            [len(p) for p in pieces if len(p) > speech.MAX_CHUNK_CHARS]

    def test_nothing_is_dropped(self):
        text = "First sentence here. Second sentence here. Third one as well."
        assert " ".join(speech.chunk(text)).split() == text.split()

    def test_short_sentences_are_packed_together(self):
        """Fewer requests is less latency, less cost and fewer audible seams."""
        text = "One. Two. Three. Four. Five."
        assert len(speech.chunk(text)) == 1

    def test_a_sentence_longer_than_the_limit_is_broken_up(self):
        text = "The situation deteriorated, " * 20          # no sentence end
        pieces = speech.chunk(text)
        assert len(pieces) > 1
        assert all(len(p) <= speech.MAX_CHUNK_CHARS for p in pieces)

    def test_a_single_enormous_word_cannot_loop_forever(self):
        pieces = speech.chunk("x" * 900)
        assert pieces and all(len(p) <= speech.MAX_CHUNK_CHARS for p in pieces)

    def test_empty_input_produces_nothing(self):
        assert speech.chunk("") == []
        assert speech.chunk("   ") == []


class TestDirection:
    """The delivery should follow what is being said."""

    def test_harm_is_delivered_gravely(self):
        assert speech.direction_for("An earthquake killed 200 people.") == \
            speech.DIRECTIONS[tone_service.SERIOUS]

    def test_neutral_text_gets_no_direction(self):
        """Groq's guidance: no direction reads more naturally than a bland one."""
        assert speech.direction_for("The committee met on Tuesday.") == ""


class TestStitching:
    def test_clips_are_joined_into_one_playable_file(self):
        joined = speech._stitch([_wav(800), _wav(500), _wav(200)])
        assert _frames(joined) == 1500

    def test_the_result_is_still_a_valid_wav(self):
        """Concatenating the bytes would bury a header mid-audio; this must not."""
        joined = speech._stitch([_wav(300), _wav(300)])
        with wave.open(io.BytesIO(joined), "rb") as handle:
            assert handle.getnchannels() == 1
            assert handle.getframerate() == 24000

    def test_streaming_headers_do_not_crash_the_writer(self):
        """The shape Groq actually returns.

        Its declared frame count is 0x7FFFFFFF, and copying that into the
        writer overflows the size field it derives from it. This raised
        struct.error against the real API while every generated fixture
        passed.
        """
        joined = speech._stitch([_streaming_wav(600), _streaming_wav(400)])
        assert _frames(joined) == 1000

    def test_a_streamed_clip_is_rewritten_with_an_honest_length(self):
        """A browser decoding 0xFFFFFFFF is told a two-second clip is a day long."""
        result = speech._stitch([_streaming_wav(500)])
        with wave.open(io.BytesIO(result), "rb") as handle:
            assert handle.getnframes() == 500

    def test_unreadable_audio_raises_rather_than_returning_junk(self):
        with pytest.raises(wave.Error):
            speech._stitch([])


class TestRefusesToSpend:
    def test_disabled_by_default(self, db, monkeypatch):
        """It is the only billed call here, so silence is the safe default."""
        monkeypatch.setattr(speech, "TTS_ENABLED", False)
        monkeypatch.setenv("GROQ_API_KEY", "test-key")
        result = speech.synthesise(db, "Hello.")
        assert result["audio"] is None and "disabled" in result["error"]

    def test_without_a_key_it_declines(self, db, monkeypatch):
        monkeypatch.setattr(speech, "TTS_ENABLED", True)
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        assert speech.synthesise(db, "Hello.")["audio"] is None

    def test_empty_text_never_reaches_the_api(self, db, enabled, monkeypatch):
        called = []
        monkeypatch.setattr(speech.requests, "post", lambda *a, **k: called.append(1))
        speech.synthesise(db, "   ")
        assert called == []

    def test_a_spent_budget_stops_it(self, db, enabled, monkeypatch):
        called = []
        monkeypatch.setattr(speech, "DAILY_BUDGET", 1)
        monkeypatch.setattr(speech.requests, "post", lambda *a, **k: called.append(1))
        from app.services import agent
        agent._record_request(db)

        result = speech.synthesise(db, "Hello.")
        assert result["audio"] is None and "limit" in result["error"]
        assert called == []

    def test_long_answers_are_capped_not_spoken_whole(self, db, enabled, monkeypatch):
        """Cost scales with characters, so the text sent is bounded."""
        sent = []

        def capture(url, headers=None, json=None, timeout=None):
            sent.append(json["input"])
            return _Reply(content=_wav(100))

        monkeypatch.setattr(speech.requests, "post", capture)
        speech.synthesise(db, "This is a sentence. " * 200)

        spoken = sum(len(s) for s in sent)
        assert spoken <= speech.MAX_TEXT_CHARS + 200, f"sent {spoken} characters"


class TestFailsQuietly:
    def test_terms_not_accepted_says_so_plainly(self, db, enabled, monkeypatch):
        monkeypatch.setattr(speech.requests, "post", lambda *a, **k: _Reply(
            status=400, text='{"error":{"code":"model_terms_required"}}'))
        result = speech.synthesise(db, "Hello.")
        assert result["audio"] is None
        assert "terms" in result["error"]

    def test_being_rate_limited_says_so(self, db, enabled, monkeypatch):
        """100 requests a day on the free tier, which a busy afternoon spends."""
        monkeypatch.setattr(speech.requests, "post",
                            lambda *a, **k: _Reply(status=429, text="rate limit reached"))
        result = speech.synthesise(db, "Hello.")
        assert result["audio"] is None
        assert "rate limited" in result["error"]

    def test_a_rate_limit_partway_keeps_what_was_spoken(self, db, enabled, monkeypatch):
        replies = iter([_Reply(content=_wav(400)), _Reply(status=429, text="slow down")])
        monkeypatch.setattr(speech.requests, "post", lambda *a, **k: next(replies))
        long_text = "First part of the answer here. " + "Second part continues on. " * 30
        result = speech.synthesise(db, long_text)
        assert result["audio"] is not None and result["error"] is None

    def test_a_rejected_key_says_so(self, db, enabled, monkeypatch):
        monkeypatch.setattr(speech.requests, "post",
                            lambda *a, **k: _Reply(status=401, text="nope"))
        assert "key" in speech.synthesise(db, "Hello.")["error"]

    def test_a_network_failure_is_not_an_exception(self, db, enabled, monkeypatch):
        def boom(*a, **k):
            raise requests.ConnectionError("down")
        monkeypatch.setattr(speech.requests, "post", boom)
        assert speech.synthesise(db, "Hello.")["audio"] is None

    def test_a_failure_partway_keeps_what_was_already_spoken(self, db, enabled, monkeypatch):
        """Half an answer in a good voice beats discarding it."""
        replies = iter([_Reply(content=_wav(400)), _Reply(status=500, text="boom")])
        monkeypatch.setattr(speech.requests, "post", lambda *a, **k: next(replies))

        long_text = "First part of the answer here. " + "Second part continues on. " * 12
        result = speech.synthesise(db, long_text)
        assert result["audio"] is not None
        assert _frames(result["audio"]) == 400


class TestSpeaks:
    def test_returns_stitched_audio_and_charges_per_request(self, db, enabled, monkeypatch):
        monkeypatch.setattr(speech.requests, "post", lambda *a, **k: _Reply(content=_wav(300)))

        text = "The first sentence runs on for a while so it fills a chunk properly. " \
               + "And here is a second sentence which also has some length to it. " \
               + "A third follows, likewise padded so the splitter has real work."
        result = speech.synthesise(db, text)

        assert result["error"] is None
        expected_chunks = len(speech.chunk(text[:speech.MAX_TEXT_CHARS]))
        assert _frames(result["audio"]) == 300 * expected_chunks

        from app.services import agent
        _, used = agent._budget_state(db)
        assert used == expected_chunks

    def test_the_direction_is_applied_to_every_request(self, db, enabled, monkeypatch):
        """Applying it only to the first drifts back to flat delivery."""
        sent = []

        def capture(url, headers=None, json=None, timeout=None):
            sent.append(json["input"])
            return _Reply(content=_wav(100))

        monkeypatch.setattr(speech.requests, "post", capture)
        # Long enough to span chunks whatever the chunk size is tuned to.
        sentence = "A bombing killed dozens. "
        monkeypatch.setattr(speech, "MAX_TEXT_CHARS", speech.MAX_CHUNK_CHARS * 3)
        speech.synthesise(db, sentence * (speech.MAX_CHUNK_CHARS * 3 // len(sentence) + 1))

        assert len(sent) > 1, "the text should have spanned more than one request"
        assert all(s.startswith(speech.DIRECTIONS[tone_service.SERIOUS]) for s in sent)

    def test_the_configured_voice_is_used_unless_overridden(self, db, enabled, monkeypatch):
        seen = []

        def capture(url, headers=None, json=None, timeout=None):
            seen.append(json["voice"])
            return _Reply(content=_wav(100))

        monkeypatch.setattr(speech.requests, "post", capture)
        speech.synthesise(db, "Hello there.")
        speech.synthesise(db, "Hello there.", voice="hannah")
        assert seen == [speech.TTS_VOICE, "hannah"]


class TestEndpoint:
    def test_returns_audio_when_it_works(self, client, monkeypatch):
        monkeypatch.setattr(speech, "TTS_ENABLED", True)
        monkeypatch.setenv("GROQ_API_KEY", "test-key")
        monkeypatch.setattr(speech.requests, "post", lambda *a, **k: _Reply(content=_wav(500)))

        response = client.post("/agent/speak", json={"text": "Good evening."})
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert _frames(response.content) == 500

    def test_returns_json_rather_than_failing_when_disabled(self, client, monkeypatch):
        """The interface needs a reason to fall back on, not a 500."""
        monkeypatch.setattr(speech, "TTS_ENABLED", False)
        response = client.post("/agent/speak", json={"text": "Good evening."})
        assert response.status_code == 200
        assert response.json()["error"]

    def test_status_reports_whether_speech_is_available(self, client, monkeypatch):
        monkeypatch.setattr(speech, "TTS_ENABLED", False)
        assert client.get("/agent/status").json()["speech_available"] is False
