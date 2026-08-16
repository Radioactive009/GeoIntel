/**
 * The palette, for the things that cannot use a class name.
 *
 * Charts, the map and inline SVG take colours as values rather than classes,
 * so they used to carry their own hex codes — which is how a "redesign" turns
 * into hunting `#22d3ee` through nine files. These read the same custom
 * properties the Tailwind theme does, so there is still one definition.
 *
 * Resolved on demand rather than at import: the properties live on :root, and
 * reading them before the stylesheet has applied returns nothing.
 */

const FALLBACKS = {
    ink: '#242120',
    body: '#47423d',
    muted: '#6c665f',
    faint: '#8d867e',
    rule: '#e6ddd0',
    'rule-strong': '#d6cab9',
    paper: '#faf7f2',
    surface: '#fffdfa',
    'surface-sunken': '#f2ece4',
    accent: '#16706b',
    'risk-high': '#b3261e',
    'risk-medium': '#c07807',
    'risk-low': '#2f7d5f',
};

/** A palette entry as a CSS colour string. */
export function token(name) {
    if (typeof window === 'undefined' || !document?.documentElement) {
        return FALLBACKS[name] || FALLBACKS.ink;
    }
    const channels = getComputedStyle(document.documentElement)
        .getPropertyValue(`--${name}`)
        .trim();
    return channels ? `rgb(${channels})` : (FALLBACKS[name] || FALLBACKS.ink);
}

/** The risk scale, which is the only saturated colour in the design. */
export const riskColor = (status) => {
    if (status === 'high') return token('risk-high');
    if (status === 'medium') return token('risk-medium');
    return token('risk-low');
};

export const riskColorByLevel = (level) => {
    if (typeof level !== 'number') return token('rule-strong');   // no data
    if (level >= 70) return token('risk-high');
    if (level >= 40) return token('risk-medium');
    return token('risk-low');
};
