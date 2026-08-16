import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { shorten } from '../lib/ask';

/**
 * A link into the assistant, carrying the question with it.
 *
 * The Ask page was a destination nothing pointed at: reachable only from the
 * nav, and then only by a reader who already knew what to type. A story, a
 * country and an event are each a question somebody is already holding, so
 * this hands it over rather than asking them to retype it.
 *
 * The question travels in the URL, which also makes it something that can be
 * sent to someone else.
 */
const AskAbout = ({ question, label = 'Ask about this', className = '' }) => {
    const text = (question || '').trim();
    if (!text) return null;

    return (
        <Link
            to={`/ask?q=${encodeURIComponent(shorten(text, 300))}`}
            className={
                className
                || 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border '
                + 'border-rule text-[12px] font-semibold text-body '
                + 'hover:text-accent hover:border-accent transition-colors'
            }
        >
            <Sparkles size={12} className="text-accent" />
            {label}
        </Link>
    );
};

export default AskAbout;
