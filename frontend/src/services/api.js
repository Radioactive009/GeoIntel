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
    q = '',
    limit = 60,
    offset = 0,
} = {}) => {
    const params = { limit, offset };
    if (country) params.country = country;
    if (region) params.region = region;
    if (level) params.level = level;
    if (q) params.q = q;
    return api.get('/articles', { params });
};

export const getAlertAnalysis = (activeOnly = true) =>
    api.get('/alert-analysis', { params: { active_only: activeOnly } });

export const getStats = () => api.get('/stats');

export const getHealth = () => api.get('/health');

export const triggerIngestion = (size = 10) =>
    api.post('/ingest-batch', null, { params: { size }, timeout: 180000 });

export { API_URL };
export default api;
