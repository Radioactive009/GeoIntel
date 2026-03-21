import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8000',
    headers: {
        'Content-Type': 'application/json',
    },
});

export const getArticles = () => api.get('/articles');
export const getRiskAnalysis = () => api.get('/risk-analysis');

export default api;
