import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Send, Sparkles, Loader2, AlertCircle, Newspaper, Mic, MicOff, Volume2, VolumeX,
    Square, Copy, Check, Clock, Info, Trash2, Search, CornerDownRight, GraduationCap,
} from 'lucide-react';
import { askAgent, getAgentStatus, getEvents, getMovers, wasAborted } from '../services/api';
import useVoice from '../hooks/useVoice';
import OwnerKey from '../components/OwnerKey';
import { isFarewell, SIGN_OFF, SILENT_TURNS_BEFORE_CLOSING } from '../lib/conversation';
import {
    buildFollowUps, buildSuggestions, describeTools, errorTone, formatAnswerForCopy, readableLines,
    FALLBACK_SUGGESTIONS,
} from '../lib/ask';
import { loadLanguage, loadMode, loadThread, saveLanguage, saveMode, saveThread } from '../lib/askStorage';
import { DEFAULT_LANGUAGE, LANGUAGES, isSupportedLanguage } from '../lib/languages';
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
 *
 * The same reasoning runs through the rest of the page. Which tools ran is
 * shown, not just what they produced. How much of the day's budget is left is
 * shown, because a reader refused mid-question deserves to have seen it
 * coming. And a refusal is styled differently from a fault, because "wait a
 * minute" and "this server is broken" are not the same news.
 */

// Enough sources to judge an answer at a glance; the rest are a click away.
const VISIBLE_SOURCES = 6;

const TONES = {
    fault: {
        icon: AlertCircle,
        box: 'border-rose-500/20 bg-rose-500/[0.06]',
        mark: 'text-rose-400',
        body: 'text-rose-200/90',
    },
    wait: {
        icon: Clock,
        box: 'border-amber-500/20 bg-amber-500/[0.06]',
        mark: 'text-amber-400',
        body: 'text-amber-200/90',
    },
    nudge: {
        icon: Info,
        box: 'border-white/10 bg-white/[0.03]',
        mark: 'text-slate-400',
        body: 'text-slate-300',
    },
};

const SourceList = ({ sources }) => {
    const [expanded, setExpanded] = useState(false);
    if (!sources?.length) return null;

    const shown = expanded ? sources : sources.slice(0, VISIBLE_SOURCES);
    const hidden = sources.length - shown.length;

    return (
        <div className="mt-4 pt-4 border-t border-white/10">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                <Newspaper size={11} /> Drawn from {sources.length} article{sources.length === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1">
                {shown.map((s) => (
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
            {/* The answer used every one of these, so a silent cut at six was
                the interface quietly overstating how much it was showing. */}
            {(hidden > 0 || expanded) && (
                <button
                    onClick={() => setExpanded((open) => !open)}
                    className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-cyan-400 transition-colors"
                >
                    {expanded ? 'Show fewer' : `Show ${hidden} more`}
                </button>
            )}
        </div>
    );
};

/** Where the answer came from, in the assistant's own steps. */
const ToolTrace = ({ toolsUsed }) => {
    const steps = describeTools(toolsUsed);
    if (!steps.length) return null;
    return (
        <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
            <Search size={11} className="mt-0.5 shrink-0" />
            <span>It {steps.join(', then ')}.</span>
        </p>
    );
};

const CopyAnswer = ({ turn }) => {
    const [copied, setCopied] = useState(false);
    const timer = useRef(null);

    useEffect(() => () => clearTimeout(timer.current), []);

    const copy = async () => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        try {
            await navigator.clipboard.writeText(formatAnswerForCopy(turn, { origin }));
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard permission denied — nothing useful to say about it */
        }
    };

    return (
        <button
            onClick={copy}
            aria-label="Copy answer and sources"
            className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-cyan-400 transition-colors shrink-0"
        >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
        </button>
    );
};

const SUGGESTION_CLASS =
    'text-left px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.02] text-[13px] '
    + 'text-slate-300 hover:border-cyan-500/30 hover:text-white transition-all';

const AskPage = () => {
    // Restored from this browser, so a stray reload does not throw away a
    // conversation that cost the site an upstream request per turn.
    const [turns, setTurns] = useState(loadThread);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);
    const [voiceMode, setVoiceMode] = useState(false);
    const [muted, setMuted] = useState(false);
    const [suggestions, setSuggestions] = useState(FALLBACK_SUGGESTIONS);
    const [language, setLanguage] = useState(() => {
        const stored = loadLanguage(DEFAULT_LANGUAGE);
        return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE;
    });
    // Asks for a study note rather than a reply: structured, specific about
    // dates and figures, and explicit about what a development bears on. The
    // sourcing is identical — the tools still run and the articles still show.
    const [mode, setMode] = useState(loadMode);
    // A model that fails to load must not leave an empty box on the page.
    const [avatarFailed, setAvatarFailed] = useState(false);
    // Hands-free: the microphone reopens itself after each answer, so a chain
    // of questions costs one press instead of one press per question.
    const [conversing, setConversing] = useState(false);
    const endRef = useRef(null);
    const sendRef = useRef(null);
    // Lets a question be abandoned. The agent can spend most of a minute on
    // tool round-trips, and the only previous way out of one was a reload.
    const abortRef = useRef(null);
    // The speech and recognition callbacks run outside render and need the
    // current hook, which is a fresh object each time. Declared here so the
    // callbacks below are not closing over a binding defined after them.
    const voiceRef = useRef(null);

    // Answers restored from a previous visit have already been heard. Without
    // this, switching voice mode on would read the last one out again.
    const spokenRef = useRef(turns.filter((turn) => turn.answer).length);

    // Held in a ref, not state: these are read inside speech and recognition
    // callbacks that fire between renders, where a captured state value is
    // stale exactly when the decision matters.
    const talk = useRef({ active: false, closing: false, silent: 0 });

    const startConversation = useCallback(() => {
        talk.current = { active: true, closing: false, silent: 0 };
        setConversing(true);
        voiceRef.current?.startListening();
    }, []);

    const endConversation = useCallback(({ afterSignOff = false } = {}) => {
        talk.current = { active: false, closing: false, silent: 0 };
        setConversing(false);
        voiceRef.current?.stopListening();
        if (!afterSignOff) voiceRef.current?.stopSpeaking();
    }, []);

    // A spoken question goes straight to the agent; waiting for the reader to
    // press send after speaking defeats the point of talking to it.
    const voice = useVoice({
        onTranscript: (text) => {
            // "No thanks" ends it; "no, what about Ukraine?" does not. The
            // distinction is in lib/conversation.js.
            if (talk.current.active && isFarewell(text)) {
                talk.current.closing = true;
                voiceRef.current?.speak(SIGN_OFF);
                return;
            }
            talk.current.silent = 0;
            sendRef.current?.(text);
        },
        onSpeechEnd: () => {
            if (!talk.current.active) return;
            if (talk.current.closing) { endConversation({ afterSignOff: true }); return; }
            // The answer has finished playing, so the microphone can open
            // without hearing the assistant's own voice.
            voiceRef.current?.startListening();
        },
        onListenEnd: (heard) => {
            const state = talk.current;
            if (!state.active || state.closing) return;
            if (heard) return;             // an answer is on its way; wait for it
            state.silent += 1;
            if (state.silent >= SILENT_TURNS_BEFORE_CLOSING) endConversation();
            else voiceRef.current?.startListening();
        },
        // Only attempt the server's voice when it says it has one, rather than
        // requesting and falling back on every single answer.
        serverSpeech: Boolean(status?.speech_available),
        language,
    });

    useEffect(() => { voiceRef.current = voice; });

    const refreshStatus = useCallback(() => {
        getAgentStatus().then((r) => setStatus(r.data)).catch(() => setStatus(null));
    }, []);

    useEffect(() => { refreshStatus(); }, [refreshStatus]);

    useEffect(() => { saveThread(turns); }, [turns]);
    useEffect(() => { saveLanguage(language); }, [language]);
    useEffect(() => { saveMode(mode); }, [mode]);

    // Openers built from what the archive is holding now. Both are cheap reads
    // the rest of the site already makes, and a failure just leaves the fixed
    // list in place rather than an empty panel.
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            getMovers({ hours: 168, limit: 3 }).then((r) => r.data).catch(() => null),
            getEvents({ hours: 168, limit: 3, minArticles: 3 }).then((r) => r.data).catch(() => null),
        ]).then(([movers, events]) => {
            if (!cancelled) setSuggestions(buildSuggestions({ movers, events: events?.events }));
        });
        return () => { cancelled = true; };
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

        const controller = new AbortController();
        abortRef.current = controller;

        // Only ever replaces the pending turn, which `busy` guarantees is last.
        const settle = (turn) => setTurns((prev) => {
            const next = [...prev];
            next[next.length - 1] = turn;
            return next;
        });

        try {
            const { data } = await askAgent(text, history, { signal: controller.signal, mode });
            settle({
                question: text,
                answer: data.answer,
                sources: data.sources,
                fromArchive: data.from_archive,
                toolsUsed: data.tools_used,
                error: data.error,
                errorKind: data.error_kind,
            });
        } catch (err) {
            // Abandoning a question is a decision, not a failure, and reporting
            // it in red would be the interface arguing with the reader.
            if (wasAborted(err)) settle({ question: text, cancelled: true });
            else {
                console.error(err);
                settle({ question: text, error: 'Could not reach the assistant.', errorKind: 'upstream' });
            }
        } finally {
            abortRef.current = null;
            setBusy(false);
            // The budget is shared with everyone else on the site, so it is
            // read back rather than decremented locally.
            refreshStatus();
        }
    }, [draft, busy, turns, mode, refreshStatus]);

    useEffect(() => { sendRef.current = send; }, [send]);

    // A question can arrive in the URL — from a story, a country, or a link
    // someone was sent. Asked once, then cleared, so a reload does not spend
    // another request on it; the thread itself is restored from storage.
    const [searchParams, setSearchParams] = useSearchParams();
    const consumedQuery = useRef(false);
    useEffect(() => {
        if (consumedQuery.current) return;
        consumedQuery.current = true;
        const incoming = (searchParams.get('q') || '').trim();
        if (!incoming) return;
        setSearchParams({}, { replace: true });
        sendRef.current?.(incoming);
    }, [searchParams, setSearchParams]);

    const stopAnswer = useCallback(() => abortRef.current?.abort(), []);

    const clearThread = useCallback(() => {
        setTurns([]);
        // Otherwise the count of answers already read stays above the count of
        // answers present, and voice mode goes quiet for the rest of the visit.
        spokenRef.current = 0;
    }, []);

    // Read new answers aloud while in voice mode.
    useEffect(() => {
        if (!voiceMode || muted) return;
        const answered = turns.filter((t) => t.answer);
        if (answered.length > spokenRef.current) {
            spokenRef.current = answered.length;
            voice.speak(answered[answered.length - 1].answer);
        }
    }, [turns, voiceMode, muted, voice]);

    // Not every turn ends in speech: the request can fail, or replies can be
    // muted. Both leave hands-free mode with nothing to chain from, so the
    // microphone has to be reopened here instead.
    const wasBusy = useRef(false);
    useEffect(() => {
        const justFinished = wasBusy.current && !busy;
        wasBusy.current = busy;
        if (!justFinished || !talk.current.active || talk.current.closing) return;

        const last = turns[turns.length - 1];
        const willSpeak = Boolean(last?.answer) && !muted && voiceMode;
        if (!willSpeak) voiceRef.current?.startListening();
    }, [busy, turns, muted, voiceMode]);

    // Leaving voice mode ends the conversation with it; otherwise the
    // microphone keeps reopening behind a panel that is no longer shown.
    useEffect(() => {
        if (voiceMode) return;
        voice.stopSpeaking();
        if (talk.current.active) endConversation();
    }, [voiceMode, voice, endConversation]);

    const unavailable = status && !status.available;

    // Hands-free needs the browser to tell us when the speaker stopped, which
    // only SpeechRecognition does. The recording fallback used by Safari and
    // Firefox runs until it is told to stop, so a conversation there would
    // record silence indefinitely; those browsers keep press-to-record.
    const handsFree = !voice.usesServerTranscription;

    const followUps = useMemo(
        () => (busy ? [] : buildFollowUps(turns[turns.length - 1])),
        [turns, busy],
    );

    const budget = status?.daily_budget || 0;
    const remaining = Math.max(0, budget - (status?.used_today || 0));
    const budgetLow = budget > 0 && remaining <= Math.max(5, budget * 0.1);

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
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setVoiceMode((on) => !on)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-[13px] font-semibold transition-all ${
                            voiceMode
                                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                                : 'border-white/10 text-slate-400 hover:text-white hover:border-white/25'
                        }`}
                    >
                        <Mic size={14} />
                        {voiceMode ? 'Voice mode on' : 'Talk to the assistant'}
                    </button>
                    <button
                        onClick={() => setMode((m) => (m === 'exam' ? 'default' : 'exam'))}
                        aria-pressed={mode === 'exam'}
                        title="Structured answers with the facts that can be cited"
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-[13px] font-semibold transition-all ${
                            mode === 'exam'
                                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                                : 'border-white/10 text-slate-400 hover:text-white hover:border-white/25'
                        }`}
                    >
                        <GraduationCap size={14} />
                        {mode === 'exam' ? 'Study answers on' : 'Study answers'}
                    </button>
                    {turns.length > 0 && (
                        <button
                            onClick={clearThread}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 text-[13px] font-semibold text-slate-400 hover:text-white hover:border-white/25 transition-all"
                        >
                            <Trash2 size={13} />
                            Clear
                        </button>
                    )}
                </div>

                {/* Said plainly and up front. Being refused mid-question by a
                    limit nobody mentioned is the worse version of this. */}
                {mode === 'exam' && (
                    <p className="mt-3 text-[12px] text-slate-500 leading-relaxed max-w-2xl">
                        Answers come back as study notes — the facts that can be cited, what a
                        development bears on, and both readings where informed people disagree.
                        Still drawn from the archive, with the articles shown.
                    </p>
                )}

                {budget > 0 && (
                    <p className={`mt-3 text-[11px] ${budgetLow ? 'text-amber-400/90' : 'text-slate-600'}`}>
                        {remaining} of {budget} questions left today, shared by everyone using the site.
                    </p>
                )}

                <div><OwnerKey /></div>
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
                            || (voice.preparing && 'Finding the words…')
                            || (voice.speaking && 'Speaking…')
                            || (conversing && 'One moment…')
                            || (handsFree ? 'Press once, then just talk' : 'Press the microphone and ask')}
                    </p>

                    <div className="flex items-center gap-3 mt-4">
                        <button
                            onClick={
                                handsFree
                                    ? (conversing ? () => endConversation() : startConversation)
                                    : (voice.listening ? voice.stopListening : voice.startListening)
                            }
                            disabled={unavailable || (!handsFree && busy)}
                            aria-label={
                                (handsFree ? conversing : voice.listening)
                                    ? 'Stop' : 'Start talking'
                            }
                            className={`p-4 rounded-full transition-all disabled:opacity-30 ${
                                (handsFree ? conversing : voice.listening)
                                    ? 'bg-rose-500 text-white scale-110 shadow-lg shadow-rose-500/30'
                                    : 'bg-cyan-500 text-white hover:bg-cyan-400'
                            }`}
                        >
                            {(handsFree ? conversing : voice.listening)
                                ? <MicOff size={20} /> : <Mic size={20} />}
                        </button>
                        <button
                            onClick={() => { setMuted((m) => !m); voice.stopSpeaking(); }}
                            aria-label={muted ? 'Unmute replies' : 'Mute replies'}
                            className="p-3 rounded-full border border-white/10 text-slate-400 hover:text-white transition-colors"
                        >
                            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        </button>
                        {/* The archive is worth asking about in more languages
                            than the one this interface happens to be in. */}
                        <label htmlFor="ask-language" className="sr-only">Question language</label>
                        <select
                            id="ask-language"
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            className="px-3 py-2 rounded-full border border-white/10 bg-transparent text-[12px] text-slate-400 hover:text-white transition-colors outline-none focus:border-cyan-500/40"
                        >
                            {LANGUAGES.map((entry) => (
                                <option key={entry.code} value={entry.code} className="bg-slate-900 text-slate-200">
                                    {entry.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {voice.error && (
                        <p className="mt-3 text-[12px] text-rose-300">{voice.error}</p>
                    )}
                    <p className="mt-2 text-[11px] text-slate-600 text-center max-w-xs">
                        {!handsFree
                            ? 'This browser has no speech recognition, so recordings are transcribed on the server. Tap to record, tap again when finished.'
                            : conversing
                                ? 'It keeps listening between answers. Say “that’s all” or press the button to finish.'
                                : 'Press once, then ask as many questions as you like.'}
                    </p>
                </div>
            )}

            <div className="flex-grow space-y-6">
                {turns.length === 0 && !unavailable && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {suggestions.map((s) => (
                            <button key={s} onClick={() => send(s)} className={SUGGESTION_CLASS}>
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                {turns.map((turn, i) => {
                    const tone = turn.error ? TONES[errorTone(turn.errorKind, turn.error)] : null;
                    const ToneIcon = tone?.icon;

                    return (
                        <div key={i} className="space-y-3">
                            <p className="font-serif text-lg text-white leading-snug">{turn.question}</p>

                            {turn.error ? (
                                <div className={`flex items-start gap-2.5 p-4 rounded-2xl border ${tone.box}`}>
                                    <ToneIcon size={15} className={`${tone.mark} mt-0.5 shrink-0`} />
                                    <p className={`text-[13px] ${tone.body}`}>{turn.error}</p>
                                </div>
                            ) : turn.cancelled ? (
                                <p className="text-[13px] text-slate-600">Stopped.</p>
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
                                    {/* Parsed into runs of text, never into markup — see
                                        readableLines. A model asked for labelled lines
                                        writes markdown, and neither rendering its HTML
                                        nor printing its asterisks is acceptable. */}
                                    {readableLines(turn.answer).map((line, j) => {
                                        const body = line.runs.map((run, k) => (
                                            run.strong
                                                ? <strong key={k} className="font-semibold text-white">{run.text}</strong>
                                                : <span key={k}>{run.text}</span>
                                        ));
                                        if (line.kind === 'heading') {
                                            return (
                                                <p key={j} className="text-[13px] font-bold uppercase tracking-wider text-slate-400 mt-4 first:mt-0 mb-2">
                                                    {body}
                                                </p>
                                            );
                                        }
                                        if (line.kind === 'bullet') {
                                            return (
                                                <p key={j} className="flex gap-2 text-[14.5px] text-slate-300 leading-[1.7] mb-1.5">
                                                    <span className="text-slate-600 shrink-0">•</span>
                                                    <span>{body}</span>
                                                </p>
                                            );
                                        }
                                        return (
                                            <p key={j} className="text-[14.5px] text-slate-300 leading-[1.7] mb-3 last:mb-0">
                                                {body}
                                            </p>
                                        );
                                    })}
                                    <div className="mt-4 flex items-start justify-between gap-4">
                                        <ToolTrace toolsUsed={turn.toolsUsed} />
                                        <CopyAnswer turn={turn} />
                                    </div>
                                    <SourceList sources={turn.sources} />
                                </div>
                            ) : (
                                <div className="flex items-center gap-2.5 text-[13px] text-slate-500">
                                    <Loader2 size={14} className="animate-spin" />
                                    Searching the archive…
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Drawn from the countries and topics the last answer actually
                    used, so they are questions this archive can answer. */}
                {followUps.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {followUps.map((question) => (
                            <button
                                key={question}
                                onClick={() => send(question)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/10 bg-white/[0.02] text-[12px] text-slate-400 hover:border-cyan-500/30 hover:text-white transition-all"
                            >
                                <CornerDownRight size={11} />
                                {question}
                            </button>
                        ))}
                    </div>
                )}
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
                    {busy ? (
                        <button
                            type="button"
                            onClick={stopAnswer}
                            aria-label="Stop"
                            className="p-2.5 rounded-xl bg-white/10 text-slate-200 hover:bg-white/15 transition-colors"
                        >
                            <Square size={16} />
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={unavailable || !draft.trim()}
                            aria-label="Send question"
                            className="p-2.5 rounded-xl bg-cyan-500 text-white disabled:opacity-25 disabled:pointer-events-none hover:bg-cyan-400 transition-colors"
                        >
                            <Send size={16} />
                        </button>
                    )}
                </div>
                <p className="text-[11px] text-slate-600 mt-2 px-2">
                    Answers are generated automatically and can be wrong. Check the sources.
                </p>
            </form>
        </div>
    );
};

export default AskPage;
