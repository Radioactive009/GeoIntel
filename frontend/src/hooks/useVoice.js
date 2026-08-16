import { useCallback, useEffect, useRef, useState } from 'react';
import { speakText, transcribeAudio } from '../services/api';
import { moodOf, pickVoice, prosodyFor, splitSentences } from '../lib/voices';
import { DEFAULT_LANGUAGE, bcp47For, voicePrefixFor } from '../lib/languages';

/**
 * Speech in and out.
 *
 * Two paths for listening, because neither alone covers everyone:
 *
 *   * The browser's SpeechRecognition where it exists (Chrome, Edge). Free,
 *     instant, nothing leaves the machine, and it streams interim text so the
 *     interface can show words appearing as they are spoken.
 *   * Recording audio and sending it to Whisper otherwise (Safari, Firefox).
 *     A round trip and a second of latency, but it works.
 *
 * Two paths for speaking, for a different reason:
 *
 *   * The server, where Orpheus is configured. It sounds like a person and
 *     takes direction on delivery. It is also the only billed call in the
 *     project, so it is off unless deliberately switched on.
 *   * The browser's own synthesis otherwise. Free, offline and universal, and
 *     plainer — though much less plain once it is given a decent voice and
 *     allowed to vary between sentences. See lib/voices.js.
 *
 * `amplitude` drives the character's mouth, and the two paths derive it very
 * differently. Real audio is measured: an analyser node reads the waveform and
 * the mouth follows what is actually being said. Browser synthesis exposes no
 * audio stream at all, so there it is inferred from word boundary events — a
 * spike per word, decaying between. That is not phonetic and does not pretend
 * to be; it reads as talking, which is the job.
 */

const Recognition =
    typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

export const useVoice = ({
    onTranscript,
    // Fired when speech finishes of its own accord, never when it is cut off.
    // Hands-free mode chains the next turn on this, and chaining on a cancelled
    // utterance would reopen the microphone the moment the reader silenced it.
    onSpeechEnd,
    // Fired when a listening session ends, with whether anything was heard.
    onListenEnd,
    serverSpeech = false,
    // ISO-639-1, or 'auto' to let the server detect it. Drives all three
    // paths: what the recogniser listens for, what the transcriber is told,
    // and which installed voice reads the answer back.
    language = DEFAULT_LANGUAGE,
} = {}) => {
    const [listening, setListening] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    // Server audio has to be fetched and decoded before any sound arrives.
    // Without this the interface sits silent and looks broken for a second or
    // two, which reads worse than the wait actually is.
    const [preparing, setPreparing] = useState(false);
    const [interim, setInterim] = useState('');
    const [amplitude, setAmplitude] = useState(0);
    const [error, setError] = useState(null);

    const recognitionRef = useRef(null);
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    const decayRef = useRef(null);
    const contextRef = useRef(null);
    const sourceRef = useRef(null);
    const frameRef = useRef(null);
    const voicesRef = useRef([]);
    // True while a stop was requested, so the natural-completion handlers can
    // tell "finished" from "was cut off" — speechSynthesis.cancel() and
    // AudioBufferSourceNode.stop() both fire the same end events as success.
    const cancelledRef = useRef(false);
    // Bumped by every stop and every new utterance. Fetching and decoding
    // server audio spans two awaits, and without a token to compare against,
    // pressing stop during them silenced nothing: the request resolved a
    // moment later and started playing regardless.
    const speechId = useRef(0);
    const heardRef = useRef(false);
    // Mirrors `listening` for the callbacks, which run between renders. Two
    // live recognition instances would each deliver the same question, and
    // every question spends an upstream request.
    const listeningRef = useRef(false);
    const onTranscriptRef = useRef(onTranscript);
    const onSpeechEndRef = useRef(onSpeechEnd);
    const onListenEndRef = useRef(onListenEnd);
    // Read inside recognition and playback callbacks, which run between
    // renders: a language captured at callback-creation time would be the one
    // selected two answers ago.
    const languageRef = useRef(language);

    useEffect(() => { languageRef.current = language; }, [language]);
    useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
    useEffect(() => { onSpeechEndRef.current = onSpeechEnd; }, [onSpeechEnd]);
    useEffect(() => { onListenEndRef.current = onListenEnd; }, [onListenEnd]);

    const finishedSpeaking = () => {
        if (cancelledRef.current) return;
        onSpeechEndRef.current?.();
    };

    const supportsNative = Boolean(Recognition);
    const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

    // getVoices() is empty on the first call in Chrome and fills in later, so
    // reading it once at speak time picks the browser default and none of the
    // ranking ever runs.
    useEffect(() => {
        if (!canSpeak) return undefined;
        const load = () => { voicesRef.current = window.speechSynthesis.getVoices() || []; };
        load();
        window.speechSynthesis.addEventListener?.('voiceschanged', load);
        return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
    }, [canSpeak]);

    // ── Speaking ─────────────────────────────────────────
    const stopAudio = useCallback(() => {
        cancelAnimationFrame(frameRef.current);
        if (sourceRef.current) {
            try { sourceRef.current.stop(); } catch { /* already ended */ }
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
    }, []);

    const stopSpeaking = useCallback(() => {
        cancelledRef.current = true;
        speechId.current += 1;
        if (canSpeak) window.speechSynthesis.cancel();
        stopAudio();
        clearInterval(decayRef.current);
        setSpeaking(false);
        setPreparing(false);
        setAmplitude(0);
    }, [canSpeak, stopAudio]);

    /** Browser synthesis, one utterance per sentence so delivery can vary. */
    const speakLocally = useCallback((text) => {
        if (!canSpeak) return;
        window.speechSynthesis.cancel();

        const sentences = splitSentences(text);
        if (!sentences.length) return;

        const browserDefault = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
        const tag = bcp47For(languageRef.current, browserDefault);
        // An answer to a Spanish question comes back in Spanish, and an English
        // voice reading it is worse than no voice at all.
        const voice = pickVoice(voicesRef.current, voicePrefixFor(languageRef.current, browserDefault));
        const mood = moodOf(text);

        const finish = () => {
            clearInterval(decayRef.current);
            setSpeaking(false);
            setAmplitude(0);
            finishedSpeaking();
        };

        sentences.forEach((sentence, index) => {
            const utterance = new SpeechSynthesisUtterance(sentence);
            const { rate, pitch } = prosodyFor(sentence, { mood, index });
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.lang = tag;
            if (voice) utterance.voice = voice;

            if (index === 0) {
                utterance.onstart = () => {
                    setSpeaking(true);
                    setPreparing(false);
                    // Between word boundaries the mouth would otherwise hold open.
                    clearInterval(decayRef.current);
                    decayRef.current = setInterval(() => {
                        setAmplitude((current) => Math.max(0, current - 0.12));
                    }, 55);
                };
            }
            utterance.onboundary = () => setAmplitude(0.55 + Math.random() * 0.45);
            if (index === sentences.length - 1) utterance.onend = finish;
            utterance.onerror = finish;

            // The queue is the browser's; consecutive utterances play in order
            // with a natural gap between them, which is the pause this wants.
            window.speechSynthesis.speak(utterance);
        });
    }, [canSpeak]);

    /** Play server audio, with the mouth following the actual waveform. */
    const playAudio = useCallback(async (blob, token) => {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return false;

        if (!contextRef.current) contextRef.current = new Context();
        const context = contextRef.current;
        // Autoplay policy suspends contexts created before a gesture.
        if (context.state === 'suspended') await context.resume();

        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        // Decoding a few seconds of audio is not instant, and a stop during it
        // must win.
        if (token !== speechId.current) return true;
        stopAudio();

        const source = context.createBufferSource();
        source.buffer = buffer;
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyser.connect(context.destination);

        const samples = new Uint8Array(analyser.fftSize);
        // The mouth interpolates towards whatever it is given, so it does not
        // need a new figure every frame — and each one re-renders the page
        // that owns this hook. Roughly 20 a second matches what the synthesis
        // path produces and is indistinguishable on screen.
        let lastPublished = 0;
        const follow = () => {
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (let i = 0; i < samples.length; i += 1) {
                const deviation = (samples[i] - 128) / 128;
                sum += deviation * deviation;
            }
            // Speech sits well below full scale, so the RMS is scaled up to
            // reach the top of the mouth's range on a loud syllable.
            const now = performance.now();
            if (now - lastPublished >= 50) {
                lastPublished = now;
                setAmplitude(Math.min(1, Math.sqrt(sum / samples.length) * 3.2));
            }
            frameRef.current = requestAnimationFrame(follow);
        };

        source.onended = () => {
            cancelAnimationFrame(frameRef.current);
            analyser.disconnect();
            source.disconnect();
            if (sourceRef.current === source) sourceRef.current = null;
            setSpeaking(false);
            setAmplitude(0);
            finishedSpeaking();
        };

        sourceRef.current = source;
        source.start();
        setSpeaking(true);
        setPreparing(false);
        follow();
        return true;
    }, [stopAudio]);

    const speak = useCallback(async (text) => {
        if (!text) return;
        stopSpeaking();
        // stopSpeaking above sets these to silence whatever was playing; this
        // utterance is a fresh one and must be allowed to report completion.
        cancelledRef.current = false;
        const token = speechId.current;

        if (serverSpeech) {
            setPreparing(true);
            try {
                const blob = await speakText(text);
                // Anything that stopped speech while the request was in flight
                // has already moved the token on; this reply is no longer wanted.
                if (token !== speechId.current) return;
                // null means the server declined — disabled, out of budget, or
                // terms unaccepted. All of them mean use the plainer voice.
                if (blob && await playAudio(blob, token)) return;
            } catch {
                // Network or decode failure. Same answer: fall back rather than
                // leave the reader with an answer nobody reads out.
            }
            if (token !== speechId.current) { setPreparing(false); return; }
            setPreparing(false);
        }

        speakLocally(text);
    }, [serverSpeech, playAudio, speakLocally, stopSpeaking]);

    // ── Listening ────────────────────────────────────────
    const startNative = useCallback(() => {
        const recognition = new Recognition();
        // No detect mode here: the browser's recogniser has to be told what to
        // listen for, so "Detect" leaves it on the browser's own language.
        recognition.lang = bcp47For(
            languageRef.current,
            typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        );
        recognition.interimResults = true;
        recognition.continuous = false;

        recognition.onstart = () => { heardRef.current = false; };
        recognition.onresult = (event) => {
            let finalText = '';
            let pending = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const result = event.results[i];
                if (result.isFinal) finalText += result[0].transcript;
                else pending += result[0].transcript;
            }
            setInterim(pending);
            setAmplitude(0.3 + Math.random() * 0.4);
            if (finalText.trim()) {
                heardRef.current = true;
                setInterim('');
                onTranscriptRef.current?.(finalText.trim());
            }
        };
        recognition.onerror = (event) => {
            // Hearing nothing is the ordinary outcome of an open microphone
            // nobody spoke into. Reporting it as an error made hands-free mode
            // accuse the reader of mumbling every time they paused to think.
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            setError(
                event.error === 'not-allowed'
                    ? 'Microphone access was blocked.'
                    : 'Could not hear that. Try again.'
            );
            setListening(false);
        };
        recognition.onend = () => {
            listeningRef.current = false;
            setListening(false);
            setInterim('');
            setAmplitude(0);
            onListenEndRef.current?.(heardRef.current);
        };

        recognitionRef.current = recognition;
        recognition.start();
    }, []);

    const startRecording = useCallback(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];

        recorder.ondataavailable = (event) => {
            if (event.data.size) chunksRef.current.push(event.data);
        };
        recorder.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
            listeningRef.current = false;
            setListening(false);
            if (blob.size < 1200) {               // a click, not a sentence
                onListenEndRef.current?.(false);
                return;
            }

            try {
                const { data } = await transcribeAudio(blob, languageRef.current);
                const heard = Boolean(data?.text?.trim());
                if (heard) onTranscriptRef.current?.(data.text.trim());
                onListenEndRef.current?.(heard);
            } catch {
                setError('Could not transcribe that.');
                onListenEndRef.current?.(false);
            }
        };

        recorderRef.current = recorder;
        recorder.start();
    }, []);

    const startListening = useCallback(async () => {
        // Hands-free reopens the microphone from several places; starting a
        // second session while one is live leaves both running.
        if (listeningRef.current) return;
        setError(null);
        stopSpeaking();
        try {
            listeningRef.current = true;
            if (supportsNative) startNative();
            else await startRecording();
            setListening(true);
        } catch {
            listeningRef.current = false;
            setError('Microphone access was blocked.');
            setListening(false);
        }
    }, [supportsNative, startNative, startRecording, stopSpeaking]);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        else { listeningRef.current = false; setListening(false); }
    }, []);

    useEffect(() => () => {
        recognitionRef.current?.abort?.();
        clearInterval(decayRef.current);
        cancelAnimationFrame(frameRef.current);
        try { sourceRef.current?.stop(); } catch { /* already ended */ }
        // One context per mount, closed on unmount. Creating one per playback
        // exhausts the browser's limit after a few dozen answers.
        contextRef.current?.close?.();
        contextRef.current = null;
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }, []);

    return {
        listening, speaking, preparing, interim, amplitude, error,
        startListening, stopListening, speak, stopSpeaking,
        canSpeak, usesServerTranscription: !supportsNative,
    };
};

export default useVoice;
