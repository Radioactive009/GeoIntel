
/**
 * Country marker rendered as an ISO-code tile rather than a flag emoji.
 *
 * Windows ships no glyphs for the regional-indicator pairs that make up flag
 * emoji, so 🇺🇸 falls back to the bare letters "US" in unstyled body text —
 * it reads as a rendering failure. A styled tile looks deliberate and
 * identical on every platform.
 */
const SIZES = {
    sm: 'w-6 h-6 text-[9px] rounded-xl',
    md: 'w-8 h-8 text-[10px] rounded-lg',
    lg: 'w-10 h-10 text-xs rounded-xl',
};

const CountryBadge = ({ code, size = 'md', className = '', title }) => {
    const label = (code || '').trim().toUpperCase();
    const isValid = label.length === 2;

    return (
        <span
            title={title || (isValid ? label : 'Unattributed')}
            className={`shrink-0 inline-flex items-center justify-center font-mono font-bold tracking-tight
                        border select-none ${SIZES[size]} ${
                isValid
                    ? 'bg-accent-soft border-accent/50 text-accent'
                    : 'bg-surface-sunken border-rule text-muted'
            } ${className}`}
        >
            {isValid ? label : '··'}
        </span>
    );
};

export default CountryBadge;
