import { useState, useEffect } from 'react';
import api from '../services/api';

interface Account {
  id: string;
  platform: string;
  nickname: string;
  avatar: string;
  status: string;
}

const PLATFORMS = [
  { id: 'xiaohongshu', name: '小红书', icon: '🔴', color: '#ff2442' },
  { id: 'wechat', name: '公众号', icon: '🟢', color: '#07c160' },
  { id: 'toutiao', name: '头条号', icon: '🟠', color: '#ff5722' },
];

const AccountsPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);

  const loadAccounts = async () => {
    try {
      const res = await api.get('/accounts');
      setAccounts(res.data);
    } catch {
      // 忽略
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const getAccount = (platform: string) => 
    accounts.find(a => a.platform === platform);

  const handleBind = async (platform: string) => {
    // 实际开发中这里会触发扫码登录流程
    try {
      await api.post('/accounts', { platform, nickname: '新账号' });
      loadAccounts();
    } catch {
      alert('绑定功能开发中');
    }
  };

  const handleUnbind = async (id: string) => {
    if (!confirm('确定要解绑这个账号吗？')) return;
    try {
      await api.delete(`/accounts/${id}`);
      loadAccounts();
    } catch {
      alert('解绑失败');
    }
  };

  return (
    <div>
      <h1 className="page-title">账号管理</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {PLATFORMS.map(p => {
          const account = getAccount(p.id);
          return (
            <div key={p.id} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>{p.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
              {account ? (
                <>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
                    {account.nickname || '已绑定'}
                  </div>
                  {account.status === 'expired' && (
                    <span className="badge badge-error">需重新授权</span>
                  )}
                  {account.status === 'active' && (
                    <span className="badge badge-success">已绑定</span>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleUnbind(account.id)}
                    >
                      解绑
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                    未绑定
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleBind(p.id)}
                  >
                    绑定账号
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AccountsPage;
