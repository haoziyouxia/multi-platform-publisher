/**
 * 应用入口
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const accountRoutes = require('./routes/accounts');
const contentRoutes = require('./routes/content');
const publishRoutes = require('./routes/publish');
const { initWebSocket } = require('./services/websocket-service');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件（上传的图片）
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API 路由
app.use('/api/accounts', accountRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/publish', publishRoutes);

// 错误处理
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || '服务器内部错误',
    code: err.code || 'INTERNAL_ERROR',
  });
});

// 启动服务
const server = app.listen(PORT, () => {
  console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
  console.log(`📋 健康检查: http://localhost:${PORT}/api/health`);
});

// 初始化 WebSocket（用于发布进度推送）
initWebSocket(server);

module.exports = app;
