/**
 * 热词规范化与融合计分
 */

function normalizeTopicKey(title) {
  if (!title) return '';
  return String(title)
    .trim()
    .toLowerCase()
    .replace(/[#＃]/g, '')
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?:：；;（）()【】\[\]]/g, '')
    .replace(/(最新|曝光|热搜|热议|爆料)$/g, '');
}

/**
 * @param {Array<{source:string, weight:number, items:Array<{title:string, rank:number, raw?:object}>}>} sourceLists
 * @param {number} topN
 */
function mergeHotlists(sourceLists, topN = 20) {
  const map = new Map();
  // 统一用 topN 作分母，避免各榜条数不同导致 rank 计分为负
  const n = Math.max(topN, 1);

  for (const list of sourceLists) {
    const items = (list.items || []).slice(0, topN);
    const weight = list.weight ?? 1;

    items.forEach((item, idx) => {
      const rank = item.rank || idx + 1;
      const title = (item.title || '').trim();
      if (!title) return;
      const key = normalizeTopicKey(title) || title;
      const sourceScore = weight * Math.max(0, (n - rank + 1) / n);

      if (!map.has(key)) {
        map.set(key, {
          topic_key: key,
          title,
          hot_score: 0,
          sources: [],
        });
      }
      const entry = map.get(key);
      entry.hot_score += sourceScore;
      entry.sources.push({
        source: list.source,
        rank,
        raw_title: title,
      });
      // 优先保留更短/更干净的展示标题
      if (title.length < entry.title.length) entry.title = title;
    });
  }

  return Array.from(map.values()).sort((a, b) => b.hot_score - a.hot_score);
}

module.exports = {
  normalizeTopicKey,
  mergeHotlists,
};
