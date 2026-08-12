import axios from 'axios';

// ── Dynamic API URL ──────────────────────────────────────
// Set VITE_API_URL at build time to point at the deployed backend.
// Without it a production build silently ships "http://localhost:8000",
// which is why the deployed dashboard showed no news.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
    console.warn(
        '[GeoIntel] VITE_API_URL is not set — this production build points at ' +
        'http://localhost:8000 and will not load data. See frontend/.env.example.'
    );
}

const api = axios.create({
    baseURL: API_URL,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
});

/**
 * Paginated article feed.
 * The backend returns { items, total, limit, offset }.
 */
export const getArticles = ({
    country = '',
    region = '',
    level = '',
    eventType = '',
    q = '',
    days = 0,
    includeDuplicates = false,
    limit = 60,
    offset = 0,
} = {}) => {
    const params = { limit, offset };
    if (country) params.country = country;
    if (region) params.region = region;
    if (level) params.level = level;
    if (eventType) params.event_type = eventType;
    if (q) params.q = q;
    if (days) params.days = days;
    if (includeDuplicates) params.include_duplicates = true;
    return api.get('/articles', { params });
};

/** One story plus its cluster siblings and same-country coverage. */
export const getArticle = (id) => api.get(`/articles/${id}`);

export const getAlertAnalysis = (activeOnly = true) =>
    api.get('/alert-analysis', { params: { active_only: activeOnly } });

export const getStats = () => api.get('/stats');

/** Every publication the feed has drawn from — used by the Sources page. */
export const getSources = () => api.get('/sources');

/** Risk history per country, thinned server-side for sparklines. */
export const getTrends = ({ hours = 168, points = 24, country = '' } = {}) => {
    const params = { hours, points };
    if (country) params.country = country;
    return api.get('/trends', { params });
};

/** Countries escalating/de-escalating against their own recent baseline. */
export const getMovers = ({ hours = 168, limit = 5 } = {}) =>
    api.get('/movers', { params: { hours, limit } });

/** Country pairs appearing in the same stories — the flashpoints board. */
export const getRelations = ({ hours = 168, limit = 10 } = {}) =>
    api.get('/relations', { params: { hours, limit } });

/**
 * Aligned world snapshots for replaying the map through time.
 * Each frame shares one timestamp across every country, which /trends cannot
 * provide because it thins each country's series independently.
 */
export const getHistoryFrames = ({ hours = 168, frames = 36 } = {}) =>
    api.get('/history-frames', { params: { hours, frames } });

/**
 * Broadcaster live streams. Liveness is resolved server-side because an
 * embedded player is cross-origin and opaque to this page.
 */
export const getChannels = ({ country = '', liveOnly = false } = {}) => {
    const params = {};
    if (country) params.country = country;
    if (liveOnly) params.live_only = true;
    return api.get('/channels', { params });
};

export const getHealth = () => api.get('/health');

export const getIngestStatus = () => api.get('/ingest-status');

/** Kick off a background ingest cycle. Returns as soon as the server accepts. */
export const triggerIngestion = (size = 10) =>
    api.post('/ingest-batch', null, { params: { size } });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start an ingest cycle and resolve once it finishes.
 *
 * The cycle used to run inside the POST, which regularly outlived both the
 * axios timeout and the 30-60s gateway timeout on a typical PaaS, so a
 * successful ingest still surfaced as a failure. The server now runs it in
 * the background and this polls for completion.
 */
export const runIngestion = async (size = 10, { timeoutMs = 300000, intervalMs = 3000 } = {}) => {
    await triggerIngestion(size);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await wait(intervalMs);
        const { data } = await getIngestStatus();
        if (!data?.running) {
            if (data?.last_error) throw new Error(data.last_error);
            return data?.last_summary || null;
        }
    }
    // Ingestion is still going; the caller refreshes anyway and picks up
    // whatever landed, rather than reporting a failure that did not happen.
    return null;
};

export { API_URL };
export default api;
