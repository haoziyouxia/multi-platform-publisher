/**
 * 数据库迁移脚本 - 创建核心表结构
 * 运行: npm run migrate
 */
const db = require('./db');

console.log('🔄 开始数据库迁移...\n');

// ========== accounts 表 ==========
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL CHECK(platform IN ('xiaohongshu', 'wechat', 'toutiao')),
    nickname TEXT,
    avatar TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'unbound')),
    session_path TEXT,
    account_info TEXT,  -- JSON: 存储额外信息
    bound_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expired_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ========== contents 表 ==========
db.exec(`
  CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,             -- HTML 正文
    images TEXT,           -- JSON: 图片路径数组
    is_unified INTEGER DEFAULT 1,  -- 1=统一内容, 0=有差异化
    platform_variants TEXT,  -- JSON: 各平台差异化内容
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ========== publish_tasks 表 ==========
db.exec(`
  CREATE TABLE IF NOT EXISTS publish_tasks (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('xiaohongshu', 'wechat', 'toutiao')),
    account_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
      'pending', 'publishing', 'published', 'reviewing', 'rejected', 'failed'
    )),
    error_message TEXT,
    platform_post_id TEXT,    -- 平台返回的文章ID
    submitted_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES contents(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
`);

// ========== 索引 ==========
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
  CREATE INDEX IF NOT EXISTS idx_publish_tasks_content_id ON publish_tasks(content_id);
  CREATE INDEX IF NOT EXISTS idx_publish_tasks_status ON publish_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_publish_tasks_platform ON publish_tasks(platform);
`);

console.log('✅ accounts 表已就绪');
console.log('✅ contents 表已就绪');
console.log('✅ publish_tasks 表已就绪');
console.log('✅ 索引已创建');
console.log('\n🎉 数据库迁移完成！');
