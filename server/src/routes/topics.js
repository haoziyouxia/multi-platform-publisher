/**
 * 选题 / 热榜 / 搜索
 */
const express = require('express');
const router = express.Router();
const topicService = require('../services/hotlist/topic-service');
const { searchAndSaveArticles, listArticlesByTopic } = require('../services/search/article-search');

// GET /api/topics?force=1
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

// POST /api/topics/:id/search  body: { force?: boolean }
router.post('/:id/search', async (req, res) => {
  try {
    const topic = topicService.getTopicById(req.params.id);
    if (!topic) {
      return res.status(404).json({ error: '赛道不存在，请先刷新热榜' });
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
  const topic = topicService.getTopicById(req.params.id);
  if (!topic) {
    return res.status(404).json({ error: '赛道不存在' });
  }
  const articles = listArticlesByTopic(topic.id);
  res.json({ articles, topic });
});

module.exports = router;
