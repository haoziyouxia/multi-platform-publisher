/**
 * 内容路由
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');

// 图片上传配置
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，仅支持 JPG/PNG/GIF`));
    }
  },
});

// 上传图片
router.post('/upload', upload.array('images', 9), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '请选择至少一张图片' });
  }

  const files = req.files.map(f => ({
    filename: f.filename,
    url: `/uploads/${f.filename}`,
    size: f.size,
    originalname: f.originalname,
  }));

  res.status(201).json({ files });
});

// 创建内容
router.post('/', (req, res) => {
  const { title, body, images, is_unified, platform_variants } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: '标题不能为空' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO contents (id, title, body, images, is_unified, platform_variants)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, title.trim(), body || '',
    images ? JSON.stringify(images) : null,
    is_unified !== undefined ? (is_unified ? 1 : 0) : 1,
    platform_variants ? JSON.stringify(platform_variants) : null
  );

  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(id);
  // 解析 JSON 字段
  content.images = content.images ? JSON.parse(content.images) : [];
  content.platform_variants = content.platform_variants ? JSON.parse(content.platform_variants) : null;
  res.status(201).json(content);
});

// 获取内容列表
router.get('/', (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const contents = db.prepare(`
    SELECT * FROM contents ORDER BY updated_at DESC LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset));

  contents.forEach(c => {
    c.images = c.images ? JSON.parse(c.images) : [];
    c.platform_variants = c.platform_variants ? JSON.parse(c.platform_variants) : null;
  });

  res.json(contents);
});

// 获取单条内容
router.get('/:id', (req, res) => {
  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id);
  if (!content) {
    return res.status(404).json({ error: '内容不存在' });
  }
  content.images = content.images ? JSON.parse(content.images) : [];
  content.platform_variants = content.platform_variants ? JSON.parse(content.platform_variants) : null;
  res.json(content);
});

// 更新内容
router.put('/:id', (req, res) => {
  const { title, body, images, is_unified, platform_variants } = req.body;
  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id);
  if (!content) {
    return res.status(404).json({ error: '内容不存在' });
  }

  db.prepare(`
    UPDATE contents SET
      title = COALESCE(?, title),
      body = COALESCE(?, body),
      images = COALESCE(?, images),
      is_unified = COALESCE(?, is_unified),
      platform_variants = COALESCE(?, platform_variants),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title, body,
    images ? JSON.stringify(images) : null,
    is_unified !== undefined ? (is_unified ? 1 : 0) : null,
    platform_variants ? JSON.stringify(platform_variants) : null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id);
  updated.images = updated.images ? JSON.parse(updated.images) : [];
  updated.platform_variants = updated.platform_variants ? JSON.parse(updated.platform_variants) : null;
  res.json(updated);
});

// 删除内容
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM contents WHERE id = ?').run(req.params.id);
  res.json({ message: '内容已删除' });
});

module.exports = router;
