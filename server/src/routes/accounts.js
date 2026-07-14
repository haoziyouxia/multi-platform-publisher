/**
 * 账号路由
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');
const browserService = require('../services/browser-service');
const loginService = require('../services/login-service');

// 获取已绑定账号列表
router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY bound_at DESC').all();
  res.json(accounts);
});

// 获取指定平台账号
router.get('/platform/:platform', (req, res) => {
  const { platform } = req.params;
  if (!['xiaohongshu', 'wechat', 'toutiao'].includes(platform)) {
    return res.status(400).json({ error: '无效的平台标识' });
  }
  const accounts = db.prepare('SELECT * FROM accounts WHERE platform = ?').all(platform);
  res.json(accounts);
});

/**
 * 启动扫码登录（浏览器自动化）
 * POST /api/accounts/login  body: { platform }
 *
 * 流程：
 *   1. 后端启动可见浏览器窗口 → 进入对应平台登录页
 *   2. 用户在浏览器中扫码完成登录
 *   3. 后端轮询登录成功 → 保存会话 → 写入/更新 accounts 表
 *   4. 返回 { ok, account }
 *
 * 该接口为长耗时操作（最长 120 秒等待扫码），前端调用时 timeout 设为 150s。
 */
router.post('/login', async (req, res) => {
  const { platform } = req.body;
  if (!platform || !['xiaohongshu', 'wechat', 'toutiao'].includes(platform)) {
    return res.status(400).json({ error: '无效的平台标识，可选: xiaohongshu / wechat / toutiao' });
  }

  try {
    const result = await loginService.login(platform);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ ok: true, account: result.account });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: `登录服务异常: ${err.message}` });
  }
});

// 创建账号绑定（仅记录绑定信息，不走扫码流程；扫码统一走 /login）
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

// 解绑账号（同时删除会话文件）
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) {
    return res.status(404).json({ error: '账号不存在' });
  }

  // 删除对应平台的会话文件
  const sessionName = `${account.platform}_default`;
  try {
    browserService.deleteSession(sessionName);
  } catch (err) {
    console.warn(`[Unbind] 删除会话失败: ${sessionName}`, err.message);
  }

  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  res.json({ message: '账号已解绑', id });
});

module.exports = router;
