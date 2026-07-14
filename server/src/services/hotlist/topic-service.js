/**
 * 热榜刷新与查询
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../../models/db');
const { fetchAllHotlists } = require('./fetchers');
const { mergeHotlists } = require('./normalize');

const CACHE_MS = Number(process.env.HOTLIST_CACHE_MS || 30 * 60 * 1000);

function getLatestSnapshotAt() {
  const row = db.prepare('SELECT snapshot_at FROM hot_topics ORDER BY snapshot_at DESC LIMIT 1').get();
  return row?.snapshot_at || null;
}

function listTopics(limit = 50) {
  const snapshotAt = getLatestSnapshotAt();
  if (!snapshotAt) return { topics: [], snapshot_at: null, source_errors: [] };

  const topics = db.prepare(`
    SELECT id, topic_key, title, hot_score, sources_json, snapshot_at, created_at
    FROM hot_topics
    WHERE snapshot_at = ?
    ORDER BY hot_score DESC
    LIMIT ?
  `).all(snapshotAt, limit);

  return {
    topics: topics.map((t) => ({
      ...t,
      sources: t.sources_json ? JSON.parse(t.sources_json) : [],
      sources_json: undefined,
    })),
    snapshot_at: snapshotAt,
  };
}

function isCacheFresh() {
  const snapshotAt = getLatestSnapshotAt();
  if (!snapshotAt) return false;
  const ts = new Date(snapshotAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < CACHE_MS;
}

/**
 * 刷新多榜并写入 DB
 */
async function refreshTopics() {
  const fetched = await fetchAllHotlists();
  const source_errors = fetched
    .filter((f) => !f.ok)
    .map((f) => ({ source: f.source, name: f.name, error: f.error }));

  const mergeInput = fetched
    .filter((f) => f.ok && f.items.length)
    .map((f) => ({
      source: f.source,
      weight: f.weight,
      items: f.items,
    }));

  if (mergeInput.length === 0) {
    // 全部失败时写入占位，避免前端空白无法演示——仅当完全无数据
    const existing = listTopics();
    if (existing.topics.length) {
      return {
        ...existing,
        source_errors,
        cached: true,
        warning: '全部热榜拉取失败，返回上次缓存',
      };
    }
    throw new Error(
      '全部热榜拉取失败: ' + source_errors.map((e) => `${e.name}:${e.error}`).join('; ')
    );
  }

  const merged = mergeHotlists(mergeInput, 20).slice(0, 40);
  const snapshotAt = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO hot_topics (id, topic_key, title, hot_score, sources_json, snapshot_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // node:sqlite DatabaseSync 无 better-sqlite3 的 transaction()，顺序写入即可
  for (const row of merged) {
    insert.run(
      uuidv4(),
      row.topic_key,
      row.title,
      row.hot_score,
      JSON.stringify(row.sources),
      snapshotAt
    );
  }

  const topics = listTopics();
  return {
    ...topics,
    source_errors,
    cached: false,
    sources_ok: fetched.filter((f) => f.ok).map((f) => f.source),
  };
}

/**
 * 获取热榜：默认走缓存
 */
async function getTopics({ force = false } = {}) {
  if (!force && isCacheFresh()) {
    return { ...listTopics(), cached: true, source_errors: [] };
  }
  // 无缓存或强制刷新
  if (!force && getLatestSnapshotAt()) {
    // 过期但有旧数据：先返回旧数据异步？一期同步刷新更直观
  }
  return refreshTopics();
}

function getTopicById(id) {
  const t = db.prepare('SELECT * FROM hot_topics WHERE id = ?').get(id);
  if (!t) return null;
  return {
    ...t,
    sources: t.sources_json ? JSON.parse(t.sources_json) : [],
    sources_json: undefined,
  };
}

module.exports = {
  getTopics,
  refreshTopics,
  listTopics,
  getTopicById,
  isCacheFresh,
};
