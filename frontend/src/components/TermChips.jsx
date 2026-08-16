import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { findTerms } from '../lib/glossary';

/**
 * The bodies and agreements a story names, linked to what they are.
 *
 * A headline says "the SCO summit" and assumes the reader knows. The archive
 * always knew which stories said that; it just had nowhere to send anyone who
 * did not know. Rendered as chips beneath the headline rather than as links
 * inside it, because rewriting an outlet's words to insert our own links is a
 * liberty this site does not otherwise take.
 */
const TermChips = ({ title, description, className = '' }) => {
    const terms = findTerms(title, description);
    if (!terms.length) return null;

    return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`}>
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
                <BookOpen size={11} /> In this story
            </span>
            {terms.map((term) => (
                <Link
                    key={term.id}
                    to={`/glossary#${term.id}`}
                    title={term.what}
                    className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.02] text-[11px] font-semibold text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-colors"
                >
                    {term.name}
                </Link>
            ))}
        </div>
    );
};

export default TermChips;
