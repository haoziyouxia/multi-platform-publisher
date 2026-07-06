/**
 * 发布路由
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');
const publishService = require('../services/publish-service');

// 执行发布
router.post('/', async (req, res) => {
  const { content_id, platforms, account_ids } = req.body;

  if (!content_id) {
    return res.status(400).json({ error: '缺少 content_id' });
  }
  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: '请至少选择一个目标平台' });
  }

  // 检查内容是否存在
  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(content_id);
  if (!content) {
    return res.status(404).json({ error: '内容不存在' });
  }

  // 创建发布任务
  const tasks = [];
  for (const platform of platforms) {
    const account = db.prepare(`
      SELECT * FROM accounts WHERE platform = ? AND status = 'active'
      ORDER BY bound_at DESC LIMIT 1
    `).get(platform);

    if (!account) {
      return res.status(400).json({ 
        error: `平台 ${platform} 未绑定账号或账号已过期` 
      });
    }

    const taskId = uuidv4();
    db.prepare(`
      INSERT INTO publish_tasks (id, content_id, platform, account_id, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(taskId, content_id, platform, account.id);

    tasks.push({ id: taskId, platform, status: 'pending' });
  }

  // 异步执行发布
  publishService.executePublish(tasks, content_id);

  res.status(201).json({
    message: `已创建 ${tasks.length} 个发布任务`,
    tasks,
  });
});

// 查询发布状态
router.get('/:taskId/status', (req, res) => {
  const task = db.prepare('SELECT * FROM publish_tasks WHERE id = ?').get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: '发布任务不存在' });
  }
  res.json(task);
});

// 重试发布
router.post('/:taskId/retry', async (req, res) => {
  const task = db.prepare('SELECT * FROM publish_tasks WHERE id = ?').get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: '发布任务不存在' });
  }
  if (task.status !== 'failed' && task.status !== 'rejected') {
    return res.status(400).json({ error: '仅失败或被驳回的任务可重试' });
  }

  db.prepare(`
    UPDATE publish_tasks SET status = 'pending', error_message = NULL, 
    submitted_at = NULL, completed_at = NULL WHERE id = ?
  `).run(task.id);

  publishService.executePublish([{ id: task.id, platform: task.platform }], task.content_id);

  res.json({ message: '重试已提交', task_id: task.id });
});

// 发布历史
router.get('/history', (req, res) => {
  const { platform, status, limit = 20, offset = 0 } = req.query;
  
  let sql = `
    SELECT pt.*, c.title as content_title 
    FROM publish_tasks pt 
    JOIN contents c ON pt.content_id = c.id 
    WHERE 1=1
  `;
  const params = [];

  if (platform) {
    sql += ' AND pt.platform = ?';
    params.push(platform);
  }
  if (status) {
    sql += ' AND pt.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY pt.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const tasks = db.prepare(sql).all(...params);
  res.json(tasks);
});

module.exports = router;
