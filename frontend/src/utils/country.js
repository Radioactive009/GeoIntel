// Shared country helpers.
// The alias table and normaliser used to be copy-pasted into both
// Dashboard.jsx and MapChart.jsx, where they could drift apart.

import NUMERIC_TO_ALPHA2 from './isoNumericToAlpha2';

// Maps the short labels used by the world-atlas TopoJSON onto the canonical
// ISO names the backend returns.
const COUNTRY_ALIASES = {
    'united states of america': 'united states',
    usa: 'united states',
    'russian federation': 'russia',
    'iran islamic republic of': 'iran',
    'iran islamic republic of the': 'iran',
    'dem rep congo': 'congo the democratic republic of the',
    'central african rep': 'central african republic',
    'dominican rep': 'dominican republic',
    'eq guinea': 'equatorial guinea',
    'falkland is': 'falkland islands malvinas',
    'bosnia and herz': 'bosnia and herzegovina',
    laos: "lao people's democratic republic",
    macedonia: 'north macedonia',
    'moldova republic of': 'moldova',
    'north korea': "korea democratic people's republic of",
    'south korea': 'korea republic of',
    'syrian arab republic': 'syria',
    'tanzania united republic of': 'tanzania',
    turkey: 'türkiye',
    'venezuela bolivarian republic of': 'venezuela',
    'viet nam': 'vietnam',
    'bolivia plurinational state of': 'bolivia',
    'palestine state of': 'palestine',
    'brunei darussalam': 'brunei',
    'solomon is': 'solomon islands',
    's sudan': 'south sudan',
    'w sahara': 'western sahara',
    'czech rep': 'czechia',
    'czech republic': 'czechia',
    "cote d'ivoire": "côte d'ivoire",
    swaziland: 'eswatini',
    'cabo verde': 'cape verde',
};

const strip = (value) =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[().,]/g, '')
        .replace(/\s+/g, ' ');

/**
 * Normalise a country name for comparison across the map, the API and the UI.
 * Applied twice so an alias that maps onto another alias still resolves.
 */
export const normalizeCountry = (value) => {
    if (!value) return '';
    const normalized = strip(value);
    return strip(COUNTRY_ALIASES[normalized] || normalized);
};

/**
 * Resolve a TopoJSON geography to an ISO alpha-2 code.
 *
 * world-atlas geographies expose only `{ name }` in properties — there is no
 * ISO_A2 field, so the previous `geo.properties.ISO_A2` lookup never matched
 * and every country had to be matched by name alone.
 */
export const geoToAlpha2 = (geo) => {
    const numericId = geo?.id ?? geo?.properties?.id;
    if (numericId != null) {
        const code = NUMERIC_TO_ALPHA2[String(parseInt(numericId, 10))];
        if (code && code !== 'XX') return code;
    }
    const direct =
        geo?.properties?.ISO_A2 || geo?.properties?.iso_a2 || geo?.properties?.ISO2;
    return direct ? String(direct).toUpperCase() : '';
};

export const getGeoName = (geoProperties) =>
    geoProperties?.name || geoProperties?.NAME || geoProperties?.ADMIN || 'Unknown';

export const getFlagEmoji = (countryCode) => {
    if (!countryCode || typeof countryCode !== 'string' || countryCode === 'Global') return '🌐';
    const code = countryCode.trim().toUpperCase();
    if (code.length !== 2) return '🌐';
    try {
        return String.fromCodePoint(...code.split('').map((char) => 127397 + char.charCodeAt()));
    } catch {
        return '🌐';
    }
};

export const getAlertColor = (status) => {
    if (status === 'high') return '#f43f5e';
    if (status === 'medium') return '#f59e0b';
    return '#10b981';
};

export const getAlertColorByLevel = (level) => {
    if (typeof level !== 'number') return '#1f2937';
    if (level >= 70) return '#f43f5e';
    if (level >= 40) return '#f59e0b';
    return '#10b981';
};

export const ALERT_STATUS_LABEL = {
    high: 'CRITICAL',
    medium: 'ELEVATED',
    low: 'STABLE',
};
