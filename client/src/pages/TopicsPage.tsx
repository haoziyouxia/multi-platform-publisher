import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

interface HotSource {
  source: string;
  rank: number;
  raw_title: string;
}

interface HotTopic {
  id: string;
  title: string;
  hot_score: number;
  sources: HotSource[];
  snapshot_at: string;
}

interface Article {
  id: string;
  title: string;
  url: string;
  snippet: string;
  body: string;
  body_status: string;
  search_engine: string;
}

interface RewriteJob {
  id: string;
  status: string;
  result_title: string;
  result_body: string;
  error_message?: string;
  content_id?: string;
  model?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  baidu_hot: '百度',
  weibo_hot: '微博',
  zhihu_hot: '知乎',
};

const TopicsPage = () => {
  const navigate = useNavigate();
  const [topics, setTopics] = useState<HotTopic[]>([]);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<any[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [filter, setFilter] = useState('');

  const [selectedTopic, setSelectedTopic] = useState<HotTopic | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [job, setJob] = useState<RewriteJob | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [applying, setApplying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  const loadTopics = async (force = false) => {
    setLoadingTopics(true);
    setMessage('');
    try {
      const res = await api.get(`/topics${force ? '?force=1' : ''}`, { timeout: 180000 });
      setTopics(res.data.topics || []);
      setSnapshotAt(res.data.snapshot_at || null);
      setSourceErrors(res.data.source_errors || []);
      if (res.data.warning) setMessage(res.data.warning);
    } catch (err: any) {
      setMessage(err.response?.data?.error || err.message || '加载热榜失败');
    } finally {
      setLoadingTopics(false);
    }
  };

  useEffect(() => {
    loadTopics(false);
  }, []);

  const selectTopic = async (topic: HotTopic, force = false) => {
    setSelectedTopic(topic);
    setSelectedArticle(null);
    setJob(null);
    setEditTitle('');
    setEditBody('');
    setLoadingArticles(true);
    setMessage(`正在搜索「${topic.title}」相关文章…`);
    try {
      const res = await api.post(
        `/topics/${topic.id}/search`,
        { force },
        { timeout: 180000 }
      );
      setArticles(res.data.articles || []);
      setMessage(
        res.data.cached
          ? '已使用近期搜索缓存（5 分钟内）'
          : `找到 ${(res.data.articles || []).length} 篇候选`
      );
    } catch (err: any) {
      setArticles([]);
      setMessage(err.response?.data?.error || err.message || '搜索失败');
    } finally {
      setLoadingArticles(false);
    }
  };

  const runRewrite = async (article: Article) => {
    setSelectedArticle(article);
    setRewriting(true);
    setJob(null);
    setMessage('AI 二创中，请稍候…');
    try {
      const res = await api.post('/rewrite', { article_id: article.id }, { timeout: 180000 });
      setJob(res.data);
      setEditTitle(res.data.result_title || '');
      setEditBody(res.data.result_body || '');
      setMessage(`二创完成（模型: ${res.data.model || '—'}）`);
    } catch (err: any) {
      setMessage(err.response?.data?.error || err.message || '二创失败');
      if (err.response?.data?.job) setJob(err.response.data.job);
    } finally {
      setRewriting(false);
    }
  };

  const applyToEditor = async () => {
    if (!job?.id) return;
    setApplying(true);
    try {
      // 若用户改过预览，先不改 DB job；apply 用服务端结果。
      // 若有本地编辑，直接创建 content。
      let contentId = job.content_id;
      if (editTitle !== job.result_title || editBody !== job.result_body) {
        const contentRes = await api.post('/content', {
          title: editTitle,
          body: editBody,
          images: [],
        });
        contentId = contentRes.data.id;
      } else {
        const contentRes = await api.post(`/rewrite/${job.id}/apply`);
        contentId = contentRes.data.id;
      }
      setMessage('已写入内容库，跳转编辑器…');
      navigate(`/?contentId=${contentId}`);
    } catch (err: any) {
      setMessage(err.response?.data?.error || err.message || '写入失败');
    } finally {
      setApplying(false);
    }
  };

  const publishWechatDraft = async () => {
    if (!editTitle.trim()) {
      setMessage('标题为空');
      return;
    }
    setPublishing(true);
    try {
      const contentRes = await api.post('/content', {
        title: editTitle,
        body: editBody,
        images: [],
      });
      const publishRes = await api.post(
        '/publish',
        { content_id: contentRes.data.id, platforms: ['wechat'] },
        { timeout: 300000 }
      );
      setMessage(`已提交公众号发布任务（${publishRes.data?.tasks?.length || 1}）`);
      navigate('/history');
    } catch (err: any) {
      setMessage(err.response?.data?.error || err.message || '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const filtered = topics.filter((t) =>
    !filter.trim() || t.title.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>选题二创</h1>
        <button
          className="btn btn-primary"
          onClick={() => loadTopics(true)}
          disabled={loadingTopics}
        >
          {loadingTopics ? '刷新中…' : '刷新热榜'}
        </button>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        多榜融合（百度 / 微博 / 知乎）→ 选一个赛道 → 自动搜文 → AI 二创 → 公众号草稿
        {snapshotAt && (
          <span> · 快照: {new Date(snapshotAt).toLocaleString()}</span>
        )}
      </p>

      {message && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            borderRadius: 8,
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            fontSize: 13,
            color: '#3730a3',
          }}
        >
          {message}
        </div>
      )}

      {sourceErrors.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 12 }}>
          部分榜源失败: {sourceErrors.map((e) => e.name || e.source).join('、')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {/* 步骤 1 热榜 */}
        <div className="card" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>① 选赛道</h3>
          <input
            className="input"
            placeholder="过滤热词…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          {loadingTopics && <div style={{ color: 'var(--text-secondary)' }}>加载热榜中…</div>}
          {!loadingTopics && filtered.length === 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              暂无数据，请点击「刷新热榜」
            </div>
          )}
          <ul style={{ listStyle: 'none' }}>
            {filtered.map((t, idx) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectTopic(t)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    marginBottom: 6,
                    borderRadius: 8,
                    border:
                      selectedTopic?.id === t.id
                        ? '1px solid var(--primary)'
                        : '1px solid var(--border)',
                    background: selectedTopic?.id === t.id ? '#eef2ff' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {idx + 1}. {t.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    分 {t.hot_score.toFixed(2)} ·{' '}
                    {(t.sources || [])
                      .map((s) => SOURCE_LABEL[s.source] || s.source)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join('/')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 步骤 2 文章 */}
        <div className="card" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 15 }}>② 候选文章</h3>
            {selectedTopic && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                disabled={loadingArticles}
                onClick={() => selectTopic(selectedTopic, true)}
              >
                重新抓取
              </button>
            )}
          </div>
          {!selectedTopic && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>请先选择左侧赛道</div>
          )}
          {loadingArticles && <div style={{ color: 'var(--text-secondary)' }}>搜索抓取中…</div>}
          <ul style={{ listStyle: 'none' }}>
            {articles.map((a) => (
              <li key={a.id} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    border:
                      selectedArticle?.id === a.id
                        ? '1px solid var(--primary)'
                        : '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {(a.snippet || a.body || '').slice(0, 100)}
                    {(a.snippet || a.body || '').length > 100 ? '…' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12 }}
                    >
                      原文
                    </a>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {a.body_status} · {a.search_engine}
                    </span>
                    <button
                      className="btn btn-primary"
                      style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }}
                      disabled={rewriting}
                      onClick={() => runRewrite(a)}
                    >
                      {rewriting && selectedArticle?.id === a.id ? '生成中…' : 'AI 二创'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* 步骤 3 二创结果 */}
        <div className="card" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>③ AI 二创预览</h3>
          {!job && !rewriting && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              选择一篇候选文章并点击「AI 二创」
            </div>
          )}
          {rewriting && <div>生成中，可能需要 30～90 秒…</div>}
          {(job?.status === 'done' || editTitle) && (
            <>
              <input
                className="input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="标题"
                style={{ marginBottom: 10, fontWeight: 600 }}
              />
              <textarea
                className="input"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={14}
                style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  onClick={applyToEditor}
                  disabled={applying || !editTitle.trim()}
                >
                  {applying ? '写入中…' : '送入内容编辑'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={publishWechatDraft}
                  disabled={publishing || !editTitle.trim()}
                >
                  {publishing ? '发布中…' : '保存并发公众号草稿'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 10 }}>
                请二次确认内容合规；勿直接搬运原文。需在 server/.env 配置 AI_API_KEY。
              </p>
            </>
          )}
          {job?.status === 'failed' && (
            <div style={{ color: 'var(--error)', fontSize: 13 }}>{job.error_message}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TopicsPage;
