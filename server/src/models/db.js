/**
 * 数据库连接与初始化
 *
 * 注意：使用 Node.js 内置的 `node:sqlite`（experimental）替代 better-sqlite3，
 * 避免在 Windows 上编译原生模块需要 Visual Studio C++ Build Tools。
 *
 * API 兼容性：
 * - DatabaseSync#prepare(sql).run(...) / .get() / .all() 与 better-sqlite3 一致
 * - DatabaseSync 没有 .pragma() 方法，改用 db.exec("PRAGMA ...")
 * - 返回行对象的原型为 null，下游代码只读取字段不依赖原型方法
 *
 * 启动时必须传 --experimental-sqlite 标志（已在 package.json scripts 中配置）。
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/app.db';

// 确保数据目录存在
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// 开启 WAL 模式 + 外键约束（DatabaseSync 没有 .pragma 方法，用 exec 代替）
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

console.log(`📦 数据库已连接: ${DB_PATH}`);

module.exports = db;
