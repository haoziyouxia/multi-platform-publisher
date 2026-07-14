import { useState, useEffect } from 'react';
import api from '../services/api';

interface Account {
  id: string;
  platform: string;
  nickname: string;
  avatar: string;
  status: string;
}

interface LoginState {
  platform: string;
  loading: boolean;
  message: string;
}

const PLATFORMS = [
  { id: 'xiaohongshu', name: '小红书', icon: '🔴', color: '#ff2442' },
  { id: 'wechat', name: '公众号', icon: '🟢', color: '#07c160' },
  { id: 'toutiao', name: '头条号', icon: '🟠', color: '#ff5722' },
];

const AccountsPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loginState, setLoginState] = useState<LoginState | null>(null);

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
    if (loginState?.loading) return;

    const platformInfo = PLATFORMS.find(p => p.id === platform);
    setLoginState({
      platform,
      loading: true,
      message: `正在启动 ${platformInfo?.name || platform} 浏览器扫码窗口，请在弹出的页面中扫码登录...`,
    });

    try {
      // 注意: 后端登录最长等待 120 秒，axios 默认 timeout 30s，这里单独加长
      const res = await api.post('/accounts/login', { platform }, { timeout: 150000 });
      if (res.data.ok) {
        loadAccounts();
        setLoginState({
          platform,
          loading: false,
          message: `✅ ${platformInfo?.name} 账号绑定成功！`,
        });
        // 2 秒后清除提示
        setTimeout(() => setLoginState(null), 2000);
      } else {
        setLoginState({
          platform,
          loading: false,
          message: `❌ 绑定失败: ${res.data.error || '未知错误'}`,
        });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || '请求失败';
      setLoginState({
        platform,
        loading: false,
        message: `❌ 绑定失败: ${msg}`,
      });
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

  const getBadge = (account: Account) => {
    switch (account.status) {
      case 'expired':
        return <span className="badge badge-error">需重新授权</span>;
      case 'active':
        return <span className="badge badge-success">已绑定</span>;
      default:
        return <span className="badge">{account.status}</span>;
    }
  };

  return (
    <div>
      <h1 className="page-title">账号管理</h1>

      {loginState && loginState.message && (
        <div
          className={`login-status ${loginState.loading ? 'loading' : 'done'}`}
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 16,
            backgroundColor: loginState.loading ? '#e8f4fd' : '#f0faf0',
            border: `1px solid ${loginState.loading ? '#b3d8f0' : '#b8e6b8'}`,
            color: loginState.loading ? '#1a5276' : '#1e7e34',
            fontSize: 14,
          }}
        >
          {loginState.message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {PLATFORMS.map(p => {
          const account = getAccount(p.id);
          const isBinding = loginState?.platform === p.id && loginState?.loading;
          return (
            <div key={p.id} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>{p.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
              {account ? (
                <>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
                    {account.nickname || '已绑定'}
                  </div>
                  {getBadge(account)}
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
                    disabled={isBinding}
                  >
                    {isBinding ? '绑定中...' : '绑定账号'}
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
