import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles, Loader2, AlertCircle, Newspaper, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { askAgent, getAgentStatus } from '../services/api';
import useVoice from '../hooks/useVoice';
import Seo from '../components/Seo';

// three.js is ~150 kB and only this page uses it, so the character loads on
// its own rather than in the route bundle.
const NewsAnchor = lazy(() => import('../components/NewsAnchor'));
const AvatarAnchor = lazy(() => import('../components/AvatarAnchor'));

// A GLB with ARKit blendshapes — a Ready Player Me avatar built from a selfie,
// or anything else exporting the same shapes. Unset, the built-in character is
// used, so the page never depends on a model being reachable.
const AVATAR_URL = import.meta.env.VITE_AVATAR_URL || '';

/**
 * Ask the archive.
 *
 * The assistant answers from this site's own data — it is given tools that
 * search the articles, read a country's standing and list the biggest events,
 * and is told to use them rather than recall. So the articles behind an
 * answer are shown next to it: a news assistant that cannot be checked is
 * worse than no assistant, and the check is the point.
 */

const SUGGESTIONS = [
    'What happened in Colombia recently?',
    'Which countries are escalating right now?',
    'What is the biggest story this week?',
    'How risky is Ukraine at the moment?',
];

const SourceList = ({ sources }) => {
    if (!sources?.length) return null;
    return (
        <div className="mt-4 pt-4 border-t border-white/10">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                <Newspaper size={11} /> Drawn from {sources.length} article{sources.length === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1">
                {sources.slice(0, 6).map((s) => (
                    <li key={s.id ?? s.title} className="text-[12px] leading-snug">
                        <Link
                            to={s.id ? `/story/${s.id}` : '#'}
                            className="text-slate-400 hover:text-cyan-400 transition-colors"
                        >
                            <span className="font-semibold text-slate-300">{s.source}</span>
                            {' · '}{s.title}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const AskPage = () => {
    const [turns, setTurns] = useState([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);
    const [voiceMode, setVoiceMode] = useState(false);
    const [muted, setMuted] = useState(false);
    // A model that fails to load must not leave an empty box on the page.
    const [avatarFailed, setAvatarFailed] = useState(false);
    const endRef = useRef(null);
    const sendRef = useRef(null);

    // A spoken question goes straight to the agent; waiting for the reader to
    // press send after speaking defeats the point of talking to it.
    const voice = useVoice({ onTranscript: (text) => sendRef.current?.(text) });

    useEffect(() => {
        getAgentStatus().then((r) => setStatus(r.data)).catch(() => setStatus(null));
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [turns, busy]);

    const send = useCallback(async (question) => {
        const text = (typeof question === 'string' ? question : draft).trim();
        if (!text || busy) return;

        setDraft('');
        setBusy(true);
        // Only prior *answered* turns are sent back, so a failed exchange does
        // not become context the model has to reason around.
        const history = turns
            .filter((t) => t.answer)
            .flatMap((t) => [
                { role: 'user', content: t.question },
                { role: 'assistant', content: t.answer },
            ]);
        setTurns((prev) => [...prev, { question: text }]);

        try {
            const { data } = await askAgent(text, history);
            setTurns((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                    question: text,
                    answer: data.answer,
                    sources: data.sources,
                    fromArchive: data.from_archive,
                    error: data.error,
                };
                return next;
            });
        } catch (err) {
            console.error(err);
            setTurns((prev) => {
                const next = [...prev];
                next[next.length - 1] = { question: text, error: 'Could not reach the assistant.' };
                return next;
            });
        } finally {
            setBusy(false);
        }
    }, [draft, busy, turns]);

    useEffect(() => { sendRef.current = send; }, [send]);

    // Read new answers aloud while in voice mode.
    const spokenRef = useRef(0);
    useEffect(() => {
        if (!voiceMode || muted) return;
        const answered = turns.filter((t) => t.answer);
        if (answered.length > spokenRef.current) {
            spokenRef.current = answered.length;
            voice.speak(answered[answered.length - 1].answer);
        }
    }, [turns, voiceMode, muted, voice]);

    useEffect(() => { if (!voiceMode) voice.stopSpeaking(); }, [voiceMode, voice]);

    const unavailable = status && !status.available;

    return (
        <div className="max-w-3xl mx-auto px-6 py-8 lg:py-12 flex flex-col min-h-[70vh]">
            <Seo
                title="Ask"
                description="Ask questions about world events and get answers drawn from the archive, with the articles behind them."
                path="/ask"
            />

            <header className="mb-8">
                <h1 className="font-display text-3xl md:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
                    <Sparkles size={26} className="text-cyan-400" />
                    Ask the archive
                </h1>
                <p className="mt-2 text-[15px] text-slate-400 leading-relaxed max-w-2xl">
                    Answers are drawn from the articles this site has collected, and the sources
                    are shown so you can check them. Background questions are answered from
                    general knowledge, and it will say so.
                </p>
                <button
                    onClick={() => setVoiceMode((on) => !on)}
                    className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full border text-[13px] font-semibold transition-all ${
                        voiceMode
                            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                            : 'border-white/10 text-slate-400 hover:text-white hover:border-white/25'
                    }`}
                >
                    <Mic size={14} />
                    {voiceMode ? 'Voice mode on' : 'Talk to the assistant'}
                </button>
            </header>

            {unavailable && (
                <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06]">
                    <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-[13px] text-amber-200/90">
                        The assistant is not configured on this server. Set <code>GROQ_API_KEY</code> to
                        enable it — everything else on the site works without it.
                    </p>
                </div>
            )}

            {voiceMode && (
                <div className="mb-8 flex flex-col items-center">
                    <div className="w-full max-w-[180px] aspect-square">
                        <Suspense fallback={
                            <div className="w-full h-full rounded-full bg-white/[0.03] animate-pulse" />
                        }>
                            {AVATAR_URL && !avatarFailed ? (
                                <AvatarAnchor
                                    url={AVATAR_URL}
                                    speaking={voice.speaking}
                                    listening={voice.listening}
                                    thinking={busy}
                                    amplitude={voice.amplitude}
                                    onFailed={() => setAvatarFailed(true)}
                                />
                            ) : (
                                <NewsAnchor
                                    speaking={voice.speaking}
                                    listening={voice.listening}
                                    thinking={busy}
                                    amplitude={voice.amplitude}
                                />
                            )}
                        </Suspense>
                    </div>

                    <p className="h-6 text-[13px] text-slate-400 text-center px-4">
                        {voice.interim
                            || (voice.listening && 'Listening…')
                            || (busy && 'Checking the archive…')
                            || (voice.speaking && 'Speaking…')
                            || 'Press the microphone and ask'}
                    </p>

                    <div className="flex items-center gap-3 mt-4">
                        <button
                            onClick={voice.listening ? voice.stopListening : voice.startListening}
                            disabled={busy || unavailable}
                            aria-label={voice.listening ? 'Stop listening' : 'Start listening'}
                            className={`p-4 rounded-full transition-all disabled:opacity-30 ${
                                voice.listening
                                    ? 'bg-rose-500 text-white scale-110 shadow-lg shadow-rose-500/30'
                                    : 'bg-cyan-500 text-white hover:bg-cyan-400'
                            }`}
                        >
                            {voice.listening ? <MicOff size={20} /> : <Mic size={20} />}
                        </button>
                        <button
                            onClick={() => { setMuted((m) => !m); voice.stopSpeaking(); }}
                            aria-label={muted ? 'Unmute replies' : 'Mute replies'}
                            className="p-3 rounded-full border border-white/10 text-slate-400 hover:text-white transition-colors"
                        >
                            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        </button>
                    </div>

                    {voice.error && (
                        <p className="mt-3 text-[12px] text-rose-300">{voice.error}</p>
                    )}
                    {voice.usesServerTranscription && (
                        <p className="mt-2 text-[11px] text-slate-600 text-center max-w-xs">
                            This browser has no speech recognition, so recordings are transcribed
                            on the server. Tap to record, tap again when finished.
                        </p>
                    )}
                </div>
            )}

            <div className="flex-grow space-y-6">
                {turns.length === 0 && !unavailable && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                onClick={() => send(s)}
                                className="text-left px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.02] text-[13px] text-slate-300 hover:border-cyan-500/30 hover:text-white transition-all"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                {turns.map((turn, i) => (
                    <div key={i} className="space-y-3">
                        <p className="font-serif text-lg text-white leading-snug">{turn.question}</p>

                        {turn.error ? (
                            <div className="flex items-start gap-2.5 p-4 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06]">
                                <AlertCircle size={15} className="text-rose-400 mt-0.5 shrink-0" />
                                <p className="text-[13px] text-rose-200/90">{turn.error}</p>
                            </div>
                        ) : turn.answer ? (
                            <div className="p-5 rounded-2xl border border-white/10 bg-slate-900/40">
                                {/* Derived server-side from whether a tool ran, so
                                    the provenance does not depend on the model
                                    choosing to admit it. */}
                                {!turn.fromArchive && (
                                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">
                                        From general knowledge — not this site&apos;s archive
                                    </p>
                                )}
                                {/* Plain paragraphs: the answer is prose, and rendering
                                    arbitrary markdown from a model is a needless risk. */}
                                {turn.answer.split('\n').filter(Boolean).map((para, j) => (
                                    <p key={j} className="text-[14.5px] text-slate-300 leading-[1.7] mb-3 last:mb-0">
                                        {para}
                                    </p>
                                ))}
                                <SourceList sources={turn.sources} />
                            </div>
                        ) : (
                            <div className="flex items-center gap-2.5 text-[13px] text-slate-500">
                                <Loader2 size={14} className="animate-spin" />
                                Searching the archive…
                            </div>
                        )}
                    </div>
                ))}
                <div ref={endRef} />
            </div>

            <form
                onSubmit={(e) => { e.preventDefault(); send(); }}
                className="sticky bottom-4 mt-8"
            >
                <div className="flex items-center gap-2 p-2 rounded-2xl border border-white/15 bg-background/95 backdrop-blur-xl shadow-2xl">
                    <label htmlFor="ask-input" className="sr-only">Ask a question</label>
                    <input
                        id="ask-input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={unavailable ? 'Assistant unavailable' : 'Ask about a country, an event, anything…'}
                        disabled={busy || unavailable}
                        maxLength={500}
                        className="flex-grow bg-transparent px-3 py-2 text-[15px] text-white placeholder:text-slate-600 outline-none disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={busy || unavailable || !draft.trim()}
                        aria-label="Send question"
                        className="p-2.5 rounded-xl bg-cyan-500 text-white disabled:opacity-25 disabled:pointer-events-none hover:bg-cyan-400 transition-colors"
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                </div>
                <p className="text-[11px] text-slate-600 mt-2 px-2">
                    Answers are generated automatically and can be wrong. Check the sources.
                </p>
            </form>
        </div>
    );
};

export default AskPage;
