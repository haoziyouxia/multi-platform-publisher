/**
 * AI 二创
 */
const express = require('express');
const router = express.Router();
const rewriteService = require('../services/rewrite-service');

// POST /api/rewrite  { article_id }
router.post('/', async (req, res) => {
  try {
    const { article_id } = req.body || {};
    if (!article_id) {
      return res.status(400).json({ error: '缺少 article_id' });
    }
    const job = await rewriteService.startRewrite(article_id);
    res.status(201).json(job);
  } catch (err) {
    console.error('[Rewrite]', err);
    res.status(err.status || 500).json({
      error: err.message || '二创失败',
      job: err.job || undefined,
    });
  }
});

// GET /api/rewrite/:id
router.get('/:id', (req, res) => {
  const job = rewriteService.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json(job);
});

// POST /api/rewrite/:id/apply
router.post('/:id/apply', (req, res) => {
  try {
    const content = rewriteService.applyToContent(req.params.id);
    res.status(201).json(content);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '应用失败' });
  }
});

module.exports = router;
