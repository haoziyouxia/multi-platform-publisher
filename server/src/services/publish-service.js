/**
 * 发布服务 - 浏览器自动化发布核心逻辑
 */
const db = require('../models/db');
const browserService = require('./browser-service');
const wsService = require('./websocket-service');

// 各平台发布器
const xiaohongshuPublisher = require('./publishers/xiaohongshu');
const wechatPublisher = require('./publishers/wechat');
const toutiaoPublisher = require('./publishers/toutiao');

const PUBLISHERS = {
  xiaohongshu: xiaohongshuPublisher,
  wechat: wechatPublisher,
  toutiao: toutiaoPublisher,
};

/**
 * 执行发布任务（异步）
 */
async function executePublish(tasks, contentId) {
  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(contentId);
  if (!content) {
    console.error('[Publish] 内容不存在:', contentId);
    return;
  }

  // 解析内容
  content.images = content.images ? JSON.parse(content.images) : [];
  content.platform_variants = content.platform_variants 
    ? JSON.parse(content.platform_variants) : null;

  // 并行发布（限制并发数）
  const maxConcurrent = Number(process.env.MAX_CONCURRENT_PUBLISH || 3);
  const chunks = [];
  for (let i = 0; i < tasks.length; i += maxConcurrent) {
    chunks.push(tasks.slice(i, i + maxConcurrent));
  }

  for (const chunk of chunks) {
    await Promise.allSettled(
      chunk.map(task => publishToPlatform(task, content))
    );
  }
}

/**
 * 向单个平台发布
 */
async function publishToPlatform(task, content) {
  const { platform } = task;
  const publisher = PUBLISHERS[platform];

  if (!publisher) {
    updateTaskStatus(task.id, 'failed', `不支持的平台: ${platform}`);
    return;
  }

  // 更新状态为发布中
  updateTaskStatus(task.id, 'publishing');
  wsService.broadcast({
    type: 'publish_progress',
    task_id: task.id,
    platform,
    status: 'publishing',
    message: `正在发布到${publisher.name}...`,
  });

  try {
    // 获取该平台的差异化内容（如果有）
    const platformContent = content.platform_variants?.[platform]
      ? { ...content, title: content.platform_variants[platform].title || content.title,
          body: content.platform_variants[platform].body || content.body }
      : content;

    // 执行发布
    const result = await publisher.publish(platformContent);

    // 更新状态
    updateTaskStatus(task.id, 'published', null, result.postId);
    wsService.broadcast({
      type: 'publish_progress',
      task_id: task.id,
      platform,
      status: 'published',
      message: `${publisher.name}发布成功`,
    });

    console.log(`[Publish] ✅ ${publisher.name} 发布成功: ${result.postId}`);
  } catch (error) {
    console.error(`[Publish] ❌ ${publisher.name} 发布失败:`, error.message);
    
    updateTaskStatus(task.id, 'failed', error.message);
    wsService.broadcast({
      type: 'publish_progress',
      task_id: task.id,
      platform,
      status: 'failed',
      message: `${publisher.name}发布失败: ${error.message}`,
    });
  }
}

/**
 * 更新任务状态
 */
function updateTaskStatus(taskId, status, errorMessage = null, platformPostId = null) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE publish_tasks SET
      status = ?,
      error_message = COALESCE(?, error_message),
      platform_post_id = COALESCE(?, platform_post_id),
      submitted_at = CASE WHEN ? IN ('publishing') AND submitted_at IS NULL THEN ? ELSE submitted_at END,
      completed_at = CASE WHEN ? IN ('published', 'failed', 'rejected') THEN ? ELSE completed_at END
    WHERE id = ?
  `).run(status, errorMessage, platformPostId, status, now, status, now, taskId);
}

module.exports = { executePublish };
