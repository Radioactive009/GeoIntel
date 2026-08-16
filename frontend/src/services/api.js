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
    tone = '',
    q = '',
    days = 0,
    includeDuplicates = false,
    // With `country`, also match stories where it is the second country named
    // — the bilateral coverage filed under the other party.
    includeSecondary = false,
    limit = 60,
    offset = 0,
} = {}) => {
    const params = { limit, offset };
    if (country) params.country = country;
    if (region) params.region = region;
    if (level) params.level = level;
    if (eventType) params.event_type = eventType;
    if (tone) params.tone = tone;
    if (q) params.q = q;
    if (days) params.days = days;
    if (includeDuplicates) params.include_duplicates = true;
    if (includeSecondary) params.include_secondary = true;
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

/** Events outlets disagreed about, ranked by spread across all of them. */
export const getContested = ({ hours = 168, limit = 8 } = {}) =>
    api.get('/contested', { params: { hours, limit } });

/** One happening: its articles, outlets, and how reported figures moved. */
export const getEvent = (key) => api.get(`/events/${key}`);

/**
 * Country pairs appearing in the same stories — the flashpoints board.
 * `country` narrows it to one country's own pairs, which is the different
 * question a country desk asks: who is this country in the news *with*.
 */
export const getRelations = ({ hours = 168, limit = 10, country = '' } = {}) => {
    const params = { hours, limit };
    if (country) params.country = country;
    return api.get('/relations', { params });
};

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

/**
 * Ask a question of the archive. Longer timeout than a normal read: the
 * agent may run several tool round-trips before it answers.
 */
/**
 * The site owner's admin key, kept in this browser only.
 *
 * Deliberately not a VITE_ variable. Vite inlines those into the bundle at
 * build time, so an admin key configured that way is published to every
 * visitor in readable JavaScript — it would authorise the whole internet to
 * spend the site's provider quota rather than the owner.
 *
 * Typed in once per browser instead, and sent only on the assistant route
 * that offers a privileged tool.
 */
const OWNER_KEY = 'geointel.ownerKey';

export const getOwnerKey = () => {
    try {
        return localStorage.getItem(OWNER_KEY) || '';
    } catch {
        return '';                       // private mode, or storage disabled
    }
};

export const setOwnerKey = (key) => {
    try {
        if (key) localStorage.setItem(OWNER_KEY, key);
        else localStorage.removeItem(OWNER_KEY);
    } catch { /* nothing to do; the key simply will not persist */ }
};

/**
 * `signal` lets the caller abandon a question. The agent may spend most of a
 * minute on tool round-trips, and without this the only way out of one is a
 * reload — which in hands-free mode also throws away the conversation.
 */
export const askAgent = (question, history = [], { signal, mode = 'default' } = {}) => {
    const key = getOwnerKey();
    return api.post('/agent/ask', { question, history, mode }, {
        timeout: 90000,
        signal,
        // Absent for ordinary readers, which is what makes refreshing the feed
        // something only the owner can ask for.
        headers: key ? { 'X-API-Key': key } : undefined,
    });
};

/** True for a request the caller abandoned, which is not a failure to report. */
export const wasAborted = (error) =>
    error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';

export const getAgentStatus = () => api.get('/agent/status');

/**
 * Transcribe recorded speech. Only used where the browser has no
 * SpeechRecognition of its own — Chrome and Edge never call this.
 */
export const transcribeAudio = (blob, language = 'en') => {
    const form = new FormData();
    form.append('audio', blob, 'speech.webm');
    // An ISO-639-1 code, or "auto" to have the server detect it.
    form.append('language', language);
    return api.post('/agent/transcribe', form, {
        timeout: 60000,
        // Let the browser set the multipart boundary; the default JSON
        // content-type on the axios instance would break the upload.
        headers: { 'Content-Type': undefined },
    });
};

/**
 * Fetch an answer as spoken audio.
 *
 * Returns a Blob, or null when the server declines — speech is optional and
 * billed, so it answers with a JSON reason rather than an error status, and
 * the caller falls back to the browser's own synthesis.
 */
export const speakText = async (text, voice) => {
    const { data } = await api.post(
        '/agent/speak',
        { text, voice },
        { responseType: 'blob', timeout: 90000 },
    );
    // A JSON body here means a refusal, not audio.
    if (data.type && data.type.includes('application/json')) return null;
    return data;
};

/**
 * The daily brief: what to know, composed server-side from counted figures.
 * `depth` raises how many events are featured — a month-long compilation read
 * for revision wants everything that met the bar, not a front page's five.
 */
export const getBrief = (hours = 24, { depth = 0 } = {}) =>
    api.get('/brief', { params: depth ? { hours, depth } : { hours } });

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
