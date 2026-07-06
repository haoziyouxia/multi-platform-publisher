/**
 * 账号路由
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');

// 获取已绑定账号列表
router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY bound_at DESC').all();
  res.json(accounts);
});

// 获取指定平台账号
router.get('/platform/:platform', (req, res) => {
  const { platform } = req.params;
  const accounts = db.prepare('SELECT * FROM accounts WHERE platform = ?').all(platform);
  res.json(accounts);
});

// 创建账号绑定（记录绑定信息）
router.post('/', (req, res) => {
  const { platform, nickname, avatar, session_path, account_info } = req.body;
  
  if (!platform || !['xiaohongshu', 'wechat', 'toutiao'].includes(platform)) {
    return res.status(400).json({ error: '无效的平台标识' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO accounts (id, platform, nickname, avatar, session_path, account_info, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(id, platform, nickname || null, avatar || null, session_path || null, 
    account_info ? JSON.stringify(account_info) : null);

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  res.status(201).json(account);
});

// 更新账号状态
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { status, nickname, avatar, session_path, expired_at } = req.body;
  
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) {
    return res.status(404).json({ error: '账号不存在' });
  }

  db.prepare(`
    UPDATE accounts SET
      status = COALESCE(?, status),
      nickname = COALESCE(?, nickname),
      avatar = COALESCE(?, avatar),
      session_path = COALESCE(?, session_path),
      expired_at = COALESCE(?, expired_at),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, nickname, avatar, session_path, expired_at, id);

  const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  res.json(updated);
});

// 解绑账号
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) {
    return res.status(404).json({ error: '账号不存在' });
  }

  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  res.json({ message: '账号已解绑', id });
});

module.exports = router;
