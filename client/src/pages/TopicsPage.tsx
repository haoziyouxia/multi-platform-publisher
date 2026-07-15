import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

interface Niche {
  id: string;
  name: string;
  emoji: string;
  description: string;
  audience: string;
  angles: string[];
  default?: boolean;
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

const TopicsPage = () => {
  const navigate = useNavigate();
  const [niches, setNiches] = useState<Niche[]>([]);
  const [selectedNiche, setSelectedNiche] = useState<Niche | null>(null);
  const [extraQuery, setExtraQuery] = useState('');

  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [searchQueries, setSearchQueries] = useState<string[]>([]);

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [job, setJob] = useState<RewriteJob | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [applying, setApplying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/topics/niches');
        const list: Niche[] = res.data.niches || [];
        setNiches(list);
        const def = list.find((n) => n.default) || list[0] || null;
        if (def) setSelectedNiche(def);
      } catch (err: any) {
        setMessage(err.response?.data?.error || err.message || '加载赛道失败');
      }
    })();
  }, []);

  const searchNiche = async (niche: Niche, force = false) => {
    setSelectedNiche(niche);
    setSelectedArticle(null);
    setJob(null);
    setEditTitle('');
    setEditBody('');
    setLoadingArticles(true);
    setMessage(`正在搜索「${niche.name}」赛道相关文章…`);
    try {
      const res = await api.post(
        `/topics/niches/${niche.id}/search`,
        { force, query: extraQuery.trim() || undefined },
        { timeout: 180000 }
      );
      setArticles(res.data.articles || []);
      setSearchQueries(res.data.queries || []);
      setMessage(
        res.data.cached
          ? `已使用「${niche.name}」近期搜索缓存`
          : res.data.warning ||
            `「${niche.name}」找到 ${(res.data.articles || []).length} 篇候选`
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
    setMessage(`AI 按「${selectedNiche?.name || '赛道'}」口吻二创中…`);
    try {
      const res = await api.post('/rewrite', { article_id: article.id }, { timeout: 180000 });
      setJob(res.data);
      setEditTitle(res.data.result_title || '');
      setEditBody(res.data.result_body || '');
      setMessage(`二创完成（${res.data.model || '—'}）· 赛道：${selectedNiche?.name || '—'}`);
    } catch (err: any) {
      setMessage(err.response?.data?.error || err.message || '二创失败');
      if (err.response?.data?.job) setJob(err.response.data.job);
    } finally {
      setRewriting(false);
    }
  };

  const applyToEditor = async () => {
    if (!job?.id && !editTitle.trim()) return;
    setApplying(true);
    try {
      let contentId = job?.content_id;
      if (!job?.id || editTitle !== job.result_title || editBody !== job.result_body) {
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
      await api.post(
        '/publish',
        { content_id: contentRes.data.id, platforms: ['wechat'] },
        { timeout: 300000 }
      );
      setMessage('已提交公众号发布任务');
      navigate('/history');
    } catch (err: any) {
      setMessage(err.response?.data?.error || err.message || '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">选题二创</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        先选<strong>垂直赛道（人群）</strong>，再搜文 → AI 按该赛道口吻二创 → 公众号草稿。
        默认推荐：<strong>中年男人</strong>。
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

      {/* 赛道选择 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>① 选择赛道</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {niches.map((n) => {
            const active = selectedNiche?.id === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedNiche(n)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 10,
                  border: active ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: active ? '#eef2ff' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 6 }}>{n.emoji}</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {n.name}
                  {n.default ? (
                    <span style={{ fontSize: 11, color: 'var(--primary)', marginLeft: 6 }}>推荐</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
                  {n.description}
                </div>
              </button>
            );
          })}
        </div>

        {selectedNiche && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              读者：{selectedNiche.audience}
              <br />
              角度：{(selectedNiche.angles || []).join(' · ')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1, minWidth: 200 }}
                placeholder="可选：补充关键词，如「裁员」「啤酒肚」「房贷」"
                value={extraQuery}
                onChange={(e) => setExtraQuery(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={loadingArticles}
                onClick={() => searchNiche(selectedNiche, true)}
              >
                {loadingArticles ? '搜索中…' : `搜索「${selectedNiche.name}」素材`}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 候选文 */}
        <div className="card" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>
            ② 候选文章
            {selectedNiche ? ` · ${selectedNiche.name}` : ''}
          </h3>
          {searchQueries.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
              搜索词：{searchQueries.join(' / ')}
            </div>
          )}
          {!articles.length && !loadingArticles && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              选好赛道后点「搜索素材」。例如选中年男人，会搜焦虑/健康/职场等方向。
            </div>
          )}
          {loadingArticles && <div style={{ color: 'var(--text-secondary)' }}>搜索抓取中，约 1～2 分钟…</div>}
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
                    {(a.snippet || a.body || '').slice(0, 120)}
                    {(a.snippet || a.body || '').length > 120 ? '…' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      原文
                    </a>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {a.body_status}
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

        {/* 二创预览 */}
        <div className="card" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>
            ③ AI 二创预览
            {selectedNiche ? ` · 写给${selectedNiche.name}` : ''}
          </h3>
          {!job && !rewriting && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              选一篇候选文点「AI 二创」，会用 {selectedNiche?.name || '当前赛道'} 的口吻改写。
            </div>
          )}
          {rewriting && <div>生成中（gpt-5.5），可能需要 30～90 秒…</div>}
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
