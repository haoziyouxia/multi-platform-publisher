import { Routes, Route, NavLink } from 'react-router-dom';
import EditorPage from './pages/EditorPage';
import HistoryPage from './pages/HistoryPage';
import AccountsPage from './pages/AccountsPage';
import TopicsPage from './pages/TopicsPage';

const App = () => {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">📤 内容分发</div>
        <ul className="sidebar-nav">
          <li>
            <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''} end>
              ✏️ 内容编辑
            </NavLink>
          </li>
          <li>
            <NavLink to="/topics" className={({ isActive }) => isActive ? 'active' : ''}>
              🔥 选题二创
            </NavLink>
          </li>
          <li>
            <NavLink to="/history" className={({ isActive }) => isActive ? 'active' : ''}>
              📋 发布历史
            </NavLink>
          </li>
          <li>
            <NavLink to="/accounts" className={({ isActive }) => isActive ? 'active' : ''}>
              🔗 账号管理
            </NavLink>
          </li>
        </ul>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<EditorPage />} />
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
