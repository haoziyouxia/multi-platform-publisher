/**
 * WebSocket 服务 - 实时推送发布进度
 */
const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('🔌 WebSocket 客户端已连接, 当前连接数:', clients.size);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        // 可以在这里处理客户端消息（如订阅特定任务）
      } catch (e) {
        // 忽略非 JSON 消息
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('🔌 WebSocket 客户端已断开, 当前连接数:', clients.size);
    });

    ws.send(JSON.stringify({ type: 'connected', message: '连接成功' }));
  });

  console.log('🔌 WebSocket 服务已启动: /ws');
}

/**
 * 广播消息给所有客户端
 */
function broadcast(data) {
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  }
}

module.exports = { initWebSocket, broadcast };
