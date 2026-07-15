/**
 * 二创任务编排
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');
const { getArticleById } = require('./search/article-search');
const { getTopicById } = require('./hotlist/topic-service');
const { getNicheById } = require('./niches/catalog');
const { rewriteArticle } = require('./ai/openai-compatible');

async function startRewrite(articleId) {
  const article = getArticleById(articleId);
  if (!article) {
    throw Object.assign(new Error('候选文章不存在'), { status: 404 });
  }

  // topic_id 可能是热词 uuid，或 niche:middle_aged_men
  let topic = null;
  let niche = null;
  if (article.topic_id && String(article.topic_id).startsWith('niche:')) {
    const nicheId = String(article.topic_id).slice('niche:'.length);
    niche = getNicheById(nicheId);
  } else if (article.topic_id) {
    topic = getTopicById(article.topic_id);
  }

  const id = uuidv4();
  const topicLabel = niche?.name || topic?.title || article.topic_title || '';

  db.prepare(`
    INSERT INTO rewrite_jobs (id, topic_id, article_id, status, input_snapshot)
    VALUES (?, ?, ?, 'running', ?)
  `).run(
    id,
    article.topic_id || null,
    articleId,
    JSON.stringify({
      topic: topicLabel,
      niche_id: niche?.id || null,
      sourceTitle: article.title,
      sourceUrl: article.url,
      body_status: article.body_status,
    })
  );

  try {
    const result = await rewriteArticle({
      topic: topicLabel,
      niche: niche
        ? {
            name: niche.name,
            audience: niche.audience,
            tone: niche.tone,
            angles: niche.angles,
          }
        : null,
      sourceTitle: article.title,
      sourceBody: article.body || article.snippet || '',
      sourceUrl: article.url,
    });

    db.prepare(`
      UPDATE rewrite_jobs SET
        status = 'done',
        model = ?,
        result_title = ?,
        result_body = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(result.model, result.title, result.body_html, id);

    return getJob(id);
  } catch (err) {
    db.prepare(`
      UPDATE rewrite_jobs SET
        status = 'failed',
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(err.message, id);
    const job = getJob(id);
    const e = new Error(err.message);
    e.status = err.code === 'AI_NOT_CONFIGURED' ? 400 : 500;
    e.job = job;
    throw e;
  }
}

function getJob(id) {
  return db.prepare('SELECT * FROM rewrite_jobs WHERE id = ?').get(id);
}

/**
 * 将二创结果写入 contents
 */
function applyToContent(jobId) {
  const job = getJob(jobId);
  if (!job) {
    throw Object.assign(new Error('二创任务不存在'), { status: 404 });
  }
  if (job.status !== 'done' || !job.result_title) {
    throw Object.assign(new Error('二创尚未完成，无法应用'), { status: 400 });
  }

  if (job.content_id) {
    const existing = db.prepare('SELECT * FROM contents WHERE id = ?').get(job.content_id);
    if (existing) {
      existing.images = existing.images ? JSON.parse(existing.images) : [];
      existing.platform_variants = existing.platform_variants
        ? JSON.parse(existing.platform_variants)
        : null;
      return existing;
    }
  }

  const contentId = uuidv4();
  db.prepare(`
    INSERT INTO contents (id, title, body, images, is_unified, status)
    VALUES (?, ?, ?, NULL, 1, 'draft')
  `).run(contentId, job.result_title, job.result_body || '');

  db.prepare(`
    UPDATE rewrite_jobs SET content_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(contentId, jobId);

  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(contentId);
  content.images = [];
  content.platform_variants = null;
  return content;
}

module.exports = {
  startRewrite,
  getJob,
  applyToContent,
};
