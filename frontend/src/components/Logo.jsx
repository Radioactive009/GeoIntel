/**
 * The masthead wordmark.
 *
 * Was a gradient shield with a pulsing status light, wordmarked GEO + cyan
 * INTEL, over "Intelligence Platform" in letterspaced caps. That is the visual
 * language of a security dashboard, and this is a publication — the shield in
 * particular claimed an authority the site does not have and does not need.
 *
 * A wordmark instead: one typeface, one weight, no ornament. The name carries
 * it, which is what a masthead is for.
 */
const Logo = ({ className = '', showText = true }) => (
    <div className={`flex items-baseline gap-2.5 ${className}`}>
        <span className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-ink leading-none">
            GeoIntel
        </span>
        {showText && (
            <span className="hidden sm:inline text-[11px] text-muted leading-none border-l border-rule pl-2.5">
                World coverage, measured
            </span>
        )}
    </div>
);

export default Logo;
