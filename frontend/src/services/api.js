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

// ── Cold-start handling ──────────────────────────────────
// Free-tier hosts (Render, Fly, Railway) stop the container after ~15 minutes
// of no traffic and boot a fresh one on the next request, which takes 30-60s.
// A single 30s timeout turns that into an error message for a request that
// would have succeeded — the reader sees a failure, reloads, and it works
// because the server is now awake.
//
// Reads are therefore retried with backoff. Writes are not: they are not
// idempotent, and retrying an ingest trigger could start a second cycle.
const RETRY_DELAYS_MS = [2000, 5000, 12000];

const wakeListeners = new Set();

/**
 * Subscribe to "the backend is asleep and we are waiting for it".
 * Returns an unsubscribe function.
 */
export const onBackendWaking = (listener) => {
    wakeListeners.add(listener);
    return () => wakeListeners.delete(listener);
};

const emitWaking = (waking) => wakeListeners.forEach((listener) => listener(waking));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

api.interceptors.response.use(
    (response) => {
        emitWaking(false);
        return response;
    },
    async (error) => {
        const config = error.config;
        // No response at all, or the request was aborted, means the host is
        // unreachable or still booting — not a 4xx/5xx the server answered.
        const looksLikeColdStart = !error.response || error.code === 'ECONNABORTED';
        const isRead = config?.method === 'get';

        if (!config || !isRead || !looksLikeColdStart) {
            emitWaking(false);
            return Promise.reject(error);
        }

        config._retryCount = config._retryCount ?? 0;
        if (config._retryCount >= RETRY_DELAYS_MS.length) {
            emitWaking(false);
            return Promise.reject(error);
        }

        emitWaking(true);
        await wait(RETRY_DELAYS_MS[config._retryCount]);
        config._retryCount += 1;
        return api(config);
    }
);

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

/**
 * Happenings ranked by how widely they were covered. An event is many
 * articles about one occurrence, which is a different unit from the article
 * feed: one earthquake is a single entry here and 70 in /articles.
 */
export const getEvents = ({ hours = 168, limit = 20, minArticles = 3, country = '' } = {}) => {
    const params = { hours, limit, min_articles: minArticles };
    if (country) params.country = country;
    return api.get('/events', { params });
};

/** One happening: its articles, outlets, and how reported figures moved. */
export const getEvent = (key) => api.get(`/events/${key}`);

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
