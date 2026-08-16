import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Copy, Check, Trash2, Download } from 'lucide-react';
import useNotes from '../hooks/useNotes';
import { notesToMarkdown } from '../lib/studyNotes';
import Seo from '../components/Seo';

/**
 * What has been put aside, and what was written about it.
 *
 * Kept in this browser and nowhere else, which is a real limitation rather
 * than a feature — so the export is prominent rather than tucked away. Notes
 * that cannot leave are notes that get lost with the browser profile.
 */
const NoteCard = ({ entry, onWrite, onRemove }) => {
    const [draft, setDraft] = useState(entry.note || '');
    const [saved, setSaved] = useState(false);

    const commit = () => {
        onWrite(entry.kind, entry.id, draft);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    return (
        <li className="p-5 rounded-2xl border border-white/10 bg-slate-900/40">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <Link
                        to={entry.kind === 'event' ? `/event/${entry.id}` : `/story/${entry.id}`}
                        className="font-display text-[16px] font-bold text-white leading-snug hover:text-cyan-400 transition-colors"
                    >
                        {entry.title}
                    </Link>
                    <p className="mt-1 text-[12px] text-slate-500">
                        {[entry.source, entry.country, entry.published].filter(Boolean).join(' · ')}
                    </p>
                </div>
                <button
                    onClick={() => onRemove(entry.kind, entry.id)}
                    aria-label={`Remove ${entry.title}`}
                    className="p-2 rounded-xl text-slate-600 hover:text-rose-400 transition-colors shrink-0"
                >
                    <Trash2 size={14} />
                </button>
            </div>

            <label htmlFor={`note-${entry.kind}-${entry.id}`} className="sr-only">
                Your note on {entry.title}
            </label>
            <textarea
                id={`note-${entry.kind}-${entry.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                rows={draft ? 3 : 1}
                maxLength={2000}
                placeholder="Why this matters, what it connects to…"
                className="mt-3 w-full bg-transparent border border-white/10 rounded-xl px-3 py-2 text-[13px] text-slate-300 placeholder:text-slate-600 outline-none focus:border-cyan-500/40 transition-colors resize-y"
            />
            {saved && <p className="mt-1 text-[11px] text-cyan-400/80">Note saved</p>}
        </li>
    );
};

const NotesPage = () => {
    const { notes, annotate, remove, clear } = useNotes();
    const [copied, setCopied] = useState(false);

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const markdown = notesToMarkdown(notes, { origin });

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(markdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard blocked */ }
    };

    const download = () => {
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'saved-stories.md';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="max-w-3xl mx-auto px-6 py-8 lg:py-12">
            <Seo title="Saved" description="Stories you have put aside, with your own notes." path="/notes" noIndex />

            <header className="border-b border-white/10 pb-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-400">
                    Your reading
                </p>
                <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                    Saved stories
                </h1>
                <p className="mt-3 text-[15px] text-slate-400 leading-relaxed max-w-2xl">
                    Kept in this browser only — no account, and nothing sent anywhere. That also
                    means they disappear with the browser profile, so export anything you intend
                    to keep.
                </p>

                {notes.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                            onClick={copy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-[12px] font-semibold text-slate-400 hover:text-white hover:border-white/25 transition-colors"
                        >
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            {copied ? 'Copied' : 'Copy as Markdown'}
                        </button>
                        <button
                            onClick={download}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-[12px] font-semibold text-slate-400 hover:text-white hover:border-white/25 transition-colors"
                        >
                            <Download size={12} /> Download
                        </button>
                        <button
                            onClick={() => { if (window.confirm(`Remove all ${notes.length} saved stories?`)) clear(); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-[12px] font-semibold text-slate-500 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
                        >
                            <Trash2 size={12} /> Clear all
                        </button>
                        <span className="text-[11px] text-slate-600 ml-auto tabular-nums">
                            {notes.length} saved
                        </span>
                    </div>
                )}
            </header>

            {notes.length === 0 ? (
                <div className="mt-10 p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                    <p className="flex items-center gap-2 text-[14px] text-slate-300">
                        <Bookmark size={15} className="text-slate-500" />
                        Nothing saved yet.
                    </p>
                    <p className="mt-2 text-[13px] text-slate-500 leading-relaxed">
                        Use <span className="text-slate-400 font-semibold">Save</span> on any story
                        or event to put it here, then write down why it mattered.{' '}
                        <Link to="/brief" className="text-cyan-400 hover:underline">Start with the brief</Link>.
                    </p>
                </div>
            ) : (
                <ul className="mt-8 space-y-4">
                    {notes.map((entry) => (
                        <NoteCard
                            key={`${entry.kind}:${entry.id}`}
                            entry={entry}
                            onWrite={annotate}
                            onRemove={remove}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
};

export default NotesPage;
