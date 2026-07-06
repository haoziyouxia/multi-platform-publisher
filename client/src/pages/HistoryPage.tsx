import { useState, useEffect } from 'react';
import api from '../services/api';

interface PublishTask {
  id: string;
  content_title: string;
  platform: string;
  status: string;
  error_message: string;
  created_at: string;
}

const PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: '小红书',
  wechat: '公众号',
  toutiao: '头条号',
};

const STATUS_BADGES: Record<string, string> = {
  pending: 'badge-info',
  publishing: 'badge-info',
  published: 'badge-success',
  reviewing: 'badge-warning',
  rejected: 'badge-error',
  failed: 'badge-error',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  publishing: '发布中',
  published: '已发布',
  reviewing: '审核中',
  rejected: '审核未通过',
  failed: '发布失败',
};

const HistoryPage = () => {
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const loadTasks = async () => {
    try {
      const params = new URLSearchParams();
      if (filterPlatform) params.set('platform', filterPlatform);
      if (filterStatus) params.set('status', filterStatus);
      const res = await api.get(`/publish/history?${params}`);
      setTasks(res.data);
    } catch {
      // 忽略
    }
  };

  useEffect(() => {
    loadTasks();
  }, [filterPlatform, filterStatus]);

  return (
    <div>
      <h1 className="page-title">发布历史</h1>

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select
          className="input"
          style={{ width: 150 }}
          value={filterPlatform}
          onChange={e => setFilterPlatform(e.target.value)}
        >
          <option value="">全部平台</option>
          <option value="xiaohongshu">小红书</option>
          <option value="wechat">公众号</option>
          <option value="toutiao">头条号</option>
        </select>
        <select
          className="input"
          style={{ width: 150 }}
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="published">已发布</option>
          <option value="reviewing">审核中</option>
          <option value="failed">失败</option>
          <option value="rejected">驳回</option>
        </select>
      </div>

      {/* 列表 */}
      <div className="card" style={{ padding: 0 }}>
        {tasks.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            暂无发布记录
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>标题</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>平台</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>状态</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)' }}>时间</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <tr key={task.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 12, fontSize: 14 }}>{task.content_title}</td>
                  <td style={{ padding: 12, fontSize: 14 }}>{PLATFORM_NAMES[task.platform]}</td>
                  <td style={{ padding: 12 }}>
                    <span className={`badge ${STATUS_BADGES[task.status] || 'badge-info'}`}>
                      {STATUS_LABELS[task.status] || task.status}
                    </span>
                    {task.error_message && (
                      <div style={{ fontSize: 12, color: 'var(--error)', marginTop: 4 }}>
                        {task.error_message}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {new Date(task.created_at).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default HistoryPage;
