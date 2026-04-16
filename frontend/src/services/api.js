import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8000',
    headers: {
        'Content-Type': 'application/json',
    },
});

export const getArticles = (country = '') => api.get('/articles', { params: country ? { country } : undefined });
export const getRiskAnalysis = () => api.get('/risk-analysis');

export default api;
