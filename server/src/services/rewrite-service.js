/**
 * 二创任务编排（异步：先返回 job，后台跑 AI）
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');
const { getArticleById } = require('./search/article-search');
const { getTopicById } = require('./hotlist/topic-service');
const { getNicheById } = require('./niches/catalog');
const { rewriteArticle } = require('./ai/openai-compatible');

/** 避免同一 job 重复执行 */
const runningJobs = new Set();

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
    VALUES (?, ?, ?, 'pending', ?)
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

  // 后台执行，不阻塞 HTTP
  setImmediate(() => {
    runRewriteJob(id).catch((err) => {
      console.error('[Rewrite] background job failed', id, err.message);
    });
  });

  return getJob(id);
}

async function runRewriteJob(jobId) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  try {
    const job = getJob(jobId);
    if (!job || job.status === 'done' || job.status === 'failed') return;

    db.prepare(`
      UPDATE rewrite_jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(jobId);

    const article = getArticleById(job.article_id);
    if (!article) {
      throw new Error('候选文章不存在或已失效');
    }

    let topic = null;
    let niche = null;
    if (article.topic_id && String(article.topic_id).startsWith('niche:')) {
      niche = getNicheById(String(article.topic_id).slice('niche:'.length));
    } else if (article.topic_id) {
      topic = getTopicById(article.topic_id);
    }

    const topicLabel = niche?.name || topic?.title || article.topic_title || '';

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
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(result.model, result.title, result.body_html, jobId);
  } catch (err) {
    const message = normalizeErrorMessage(err);
    console.error('[Rewrite] job', jobId, message);
    db.prepare(`
      UPDATE rewrite_jobs SET
        status = 'failed',
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(message, jobId);
  } finally {
    runningJobs.delete(jobId);
  }
}

function normalizeErrorMessage(err) {
  if (!err) return '二创失败';
  const name = err.name || '';
  const msg = err.message || String(err);
  if (name === 'AbortError' || /aborted|abort/i.test(msg)) {
    return 'AI 请求超时，请稍后重试（可增大 server/.env 中 AI_TIMEOUT_MS）';
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
    return `无法连接 AI 服务：${msg}`;
  }
  return msg;
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
  runRewriteJob,
};
