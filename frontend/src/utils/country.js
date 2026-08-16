// Shared country helpers.
// The alias table and normaliser used to be copy-pasted into both
// Dashboard.jsx and MapChart.jsx, where they could drift apart.

import NUMERIC_TO_ALPHA2 from './isoNumericToAlpha2';
import { riskColor, riskColorByLevel } from './palette';

// Maps the short labels used by the world-atlas TopoJSON onto the canonical
// ISO names the backend returns.
// Every alias resolves *towards* the name the API now returns, so the map's
// abbreviations and the ISO register's legal designations both land on the
// same string. The backend used to serve "Russian Federation" and "Korea,
// Democratic People's Republic of"; it now serves the names a newsroom
// prints, and these follow.
const COUNTRY_ALIASES = {
    'united states of america': 'united states',
    usa: 'united states',
    'russian federation': 'russia',
    'iran islamic republic of': 'iran',
    'iran islamic republic of the': 'iran',
    'dem rep congo': 'dr congo',
    'democratic republic of the congo': 'dr congo',
    'congo the democratic republic of the': 'dr congo',
    'congo dem rep': 'dr congo',
    'central african rep': 'central african republic',
    'dominican rep': 'dominican republic',
    'eq guinea': 'equatorial guinea',
    'falkland is': 'falkland islands',
    'falkland islands malvinas': 'falkland islands',
    'bosnia and herz': 'bosnia and herzegovina',
    "lao people's democratic republic": 'laos',
    'lao peoples democratic republic': 'laos',
    macedonia: 'north macedonia',
    'moldova republic of': 'moldova',
    "korea democratic people's republic of": 'north korea',
    'korea republic of': 'south korea',
    'syrian arab republic': 'syria',
    'tanzania united republic of': 'tanzania',
    'türkiye': 'turkey',
    turkiye: 'turkey',
    'venezuela bolivarian republic of': 'venezuela',
    'taiwan province of china': 'taiwan',
    'viet nam': 'vietnam',
    'bolivia plurinational state of': 'bolivia',
    'palestine state of': 'palestine',
    'brunei darussalam': 'brunei',
    'micronesia federated states of': 'micronesia',
    'holy see': 'vatican city',
    'holy see vatican city state': 'vatican city',
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

/**
 * Does `selected` refer to this country?
 *
 * The selection may be an ISO alpha-2 code (map clicks, which have an exact
 * numeric id to work from) or a display name (the sidebar's <select>). Both
 * are accepted so the map, the feed filter and the live player agree on what
 * is selected without every caller having to know which form it holds.
 */
export const matchesCountry = (selected, { name, iso } = {}) => {
    const value = (selected || '').toString().trim();
    if (!value) return false;
    if (iso && value.length === 2 && value.toUpperCase() === iso.toUpperCase()) return true;
    return Boolean(name) && normalizeCountry(value) === normalizeCountry(name);
};

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

// Kept as re-exports so the many existing call sites do not all have to move;
// the values themselves now come from the one palette definition.
export const getAlertColor = riskColor;
export const getAlertColorByLevel = riskColorByLevel;

export const ALERT_STATUS_LABEL = {
    high: 'CRITICAL',
    medium: 'ELEVATED',
    low: 'STABLE',
};
