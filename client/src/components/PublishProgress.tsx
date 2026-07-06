import { useEffect, useState } from 'react';

interface PublishProgressProps {
  tasks: { id: string; platform: string; status: string }[];
}

const PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: '小红书',
  wechat: '公众号',
  toutiao: '头条号',
};

const PublishProgress = ({ tasks }: PublishProgressProps) => {
  const [taskStatuses, setTaskStatuses] = useState(tasks);

  // 通过 WebSocket 监听发布进度
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'publish_progress') {
        setTaskStatuses(prev =>
          prev.map(t =>
            t.id === data.task_id
              ? { ...t, status: data.status }
              : t
          )
        );
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>发布进度</div>
      {taskStatuses.map(task => (
        <div
          key={task.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span>{PLATFORM_NAMES[task.platform] || task.platform}</span>
          <span className={`badge ${
            task.status === 'published' ? 'badge-success' :
            task.status === 'failed' ? 'badge-error' :
            'badge-info'
          }`}>
            {task.status === 'published' ? '✅ 已发布' :
             task.status === 'failed' ? '❌ 失败' :
             task.status === 'publishing' ? '🔄 发布中...' :
             '⏳ 等待中'}
          </span>
        </div>
      ))}
    </div>
  );
};

export default PublishProgress;
