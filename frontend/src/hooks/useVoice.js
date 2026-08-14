import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../services/api';

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
 * Speaking uses the browser's own synthesis. Groq offers no text-to-speech on
 * this account — its one speech model requires accepting terms in the console
 * first — and browser synthesis is free, offline and universal, if plainer.
 *
 * `amplitude` exists so the character's mouth has something to follow. Speech
 * synthesis exposes no audio stream to analyse, so it is derived from word
 * boundary events: a spike as each word starts, decaying between them. It is
 * not phonetic and does not pretend to be — it reads as talking, which is the
 * job.
 */

const Recognition =
    typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

export const useVoice = ({ onTranscript } = {}) => {
    const [listening, setListening] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [interim, setInterim] = useState('');
    const [amplitude, setAmplitude] = useState(0);
    const [error, setError] = useState(null);

    const recognitionRef = useRef(null);
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    const decayRef = useRef(null);
    const onTranscriptRef = useRef(onTranscript);

    useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

    const supportsNative = Boolean(Recognition);
    const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

    // ── Speaking ─────────────────────────────────────────
    const stopSpeaking = useCallback(() => {
        if (canSpeak) window.speechSynthesis.cancel();
        clearInterval(decayRef.current);
        setSpeaking(false);
        setAmplitude(0);
    }, [canSpeak]);

    const speak = useCallback((text) => {
        if (!canSpeak || !text) return;
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.02;
        utterance.pitch = 1.05;

        // Prefer a natural-sounding English voice where the platform has one;
        // the default is often the most robotic option installed.
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find((v) =>
            /en-(GB|US)/i.test(v.lang) && /natural|google|samantha|daniel|aria/i.test(v.name)
        ) || voices.find((v) => /^en/i.test(v.lang));
        if (preferred) utterance.voice = preferred;

        utterance.onstart = () => {
            setSpeaking(true);
            // Between word boundaries the mouth would otherwise hold open.
            clearInterval(decayRef.current);
            decayRef.current = setInterval(() => {
                setAmplitude((current) => Math.max(0, current - 0.12));
            }, 55);
        };
        utterance.onboundary = () => setAmplitude(0.55 + Math.random() * 0.45);
        const finish = () => {
            clearInterval(decayRef.current);
            setSpeaking(false);
            setAmplitude(0);
        };
        utterance.onend = finish;
        utterance.onerror = finish;

        window.speechSynthesis.speak(utterance);
    }, [canSpeak]);

    // ── Listening ────────────────────────────────────────
    const startNative = useCallback(() => {
        const recognition = new Recognition();
        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.continuous = false;

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
                setInterim('');
                onTranscriptRef.current?.(finalText.trim());
            }
        };
        recognition.onerror = (event) => {
            setError(
                event.error === 'not-allowed'
                    ? 'Microphone access was blocked.'
                    : 'Could not hear that. Try again.'
            );
            setListening(false);
        };
        recognition.onend = () => { setListening(false); setInterim(''); setAmplitude(0); };

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
            setListening(false);
            if (blob.size < 1200) return;         // a click, not a sentence

            try {
                const { data } = await transcribeAudio(blob);
                if (data?.text?.trim()) onTranscriptRef.current?.(data.text.trim());
                else setError(data?.error || 'Nothing was picked up.');
            } catch {
                setError('Could not transcribe that.');
            }
        };

        recorderRef.current = recorder;
        recorder.start();
    }, []);

    const startListening = useCallback(async () => {
        setError(null);
        stopSpeaking();
        try {
            if (supportsNative) startNative();
            else await startRecording();
            setListening(true);
        } catch {
            setError('Microphone access was blocked.');
            setListening(false);
        }
    }, [supportsNative, startNative, startRecording, stopSpeaking]);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        else setListening(false);
    }, []);

    useEffect(() => () => {
        recognitionRef.current?.abort?.();
        clearInterval(decayRef.current);
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }, []);

    return {
        listening, speaking, interim, amplitude, error,
        startListening, stopListening, speak, stopSpeaking,
        canSpeak, usesServerTranscription: !supportsNative,
    };
};

export default useVoice;
