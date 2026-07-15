/**
 * 选题 / 垂直赛道 / 热榜 / 搜索
 */
const express = require('express');
const router = express.Router();
const topicService = require('../services/hotlist/topic-service');
const { listNiches, getNicheById, pickSearchQueries } = require('../services/niches/catalog');
const { searchAndSaveArticles, listArticlesByTopic } = require('../services/search/article-search');

// GET /api/topics/niches — 垂直赛道列表（固定受众向）
router.get('/niches', (req, res) => {
  res.json({ niches: listNiches() });
});

// POST /api/topics/niches/:nicheId/search  body: { force?, query? }
router.post('/niches/:nicheId/search', async (req, res) => {
  try {
    const niche = getNicheById(req.params.nicheId);
    if (!niche) {
      return res.status(404).json({ error: '未知赛道' });
    }
    const force = !!(req.body && req.body.force);
    const userQuery = (req.body && req.body.query) || '';
    const queries = pickSearchQueries(niche, userQuery, 3);
    const topic = {
      id: `niche:${niche.id}`,
      title: niche.name,
      queries,
      niche_id: niche.id,
    };
    const result = await searchAndSaveArticles(topic, { force });
    res.json({
      ...result,
      niche: {
        id: niche.id,
        name: niche.name,
        description: niche.description,
        audience: niche.audience,
        angles: niche.angles,
      },
    });
  } catch (err) {
    console.error('[Niche search]', err);
    res.status(500).json({ error: err.message || '赛道搜索失败' });
  }
});

// GET /api/topics/niches/:nicheId/articles
router.get('/niches/:nicheId/articles', (req, res) => {
  const niche = getNicheById(req.params.nicheId);
  if (!niche) {
    return res.status(404).json({ error: '未知赛道' });
  }
  const topicId = `niche:${niche.id}`;
  const articles = listArticlesByTopic(topicId);
  res.json({ articles, niche: { id: niche.id, name: niche.name }, topic_id: topicId });
});

// GET /api/topics?force=1 — 热搜词（辅助，非主赛道）
router.get('/', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const data = await topicService.getTopics({ force });
    res.json(data);
  } catch (err) {
    console.error('[Topics]', err);
    res.status(500).json({ error: err.message || '获取热榜失败' });
  }
});

// POST /api/topics/refresh
router.post('/refresh', async (req, res) => {
  try {
    const data = await topicService.refreshTopics();
    res.json(data);
  } catch (err) {
    console.error('[Topics refresh]', err);
    res.status(500).json({ error: err.message || '刷新热榜失败' });
  }
});

// POST /api/topics/:id/search  body: { force?: boolean } — 热搜词搜索（兼容旧逻辑）
router.post('/:id/search', async (req, res) => {
  try {
    // 避免与 /niches/* 冲突（express 按注册顺序，niches 已在前）
    if (req.params.id === 'niches') {
      return res.status(404).json({ error: 'not found' });
    }
    const topic = topicService.getTopicById(req.params.id);
    if (!topic) {
      return res.status(404).json({ error: '热词不存在，请先刷新热榜' });
    }
    const force = !!(req.body && req.body.force);
    const result = await searchAndSaveArticles(topic, { force });
    res.json(result);
  } catch (err) {
    console.error('[Topics search]', err);
    res.status(500).json({ error: err.message || '搜索抓取失败' });
  }
});

// GET /api/topics/:id/articles
router.get('/:id/articles', (req, res) => {
  if (req.params.id === 'niches') {
    return res.status(404).json({ error: 'not found' });
  }
  const topic = topicService.getTopicById(req.params.id);
  if (!topic) {
    return res.status(404).json({ error: '热词不存在' });
  }
  const articles = listArticlesByTopic(topic.id);
  res.json({ articles, topic });
});

module.exports = router;
