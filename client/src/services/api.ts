import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// 响应拦截器
api.interceptors.response.use(
  response => response.data,
  error => {
    const message = error.response?.data?.error || '网络请求失败';
    console.error('[API Error]', message);
    return Promise.reject(error);
  }
);

export default api;
