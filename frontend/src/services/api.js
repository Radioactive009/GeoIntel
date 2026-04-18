import axios from 'axios';

// ── Dynamic API URL ──────────────────────────────────────
// Uses the VITE_API_URL environment variable if present (production).
// Otherwise, defaults to localhost:8000 for local development.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export const getArticles = (country = '') => api.get('/articles', { params: country ? { country } : undefined });
export const getAlertAnalysis = () => api.get('/alert-analysis');
export const triggerIngestion = () => api.post('/ingest-batch', null, { params: { size: 10 } });

export default api;
