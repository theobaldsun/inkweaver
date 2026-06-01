/**
 * 将指定用户密码从旧版 bcrypt(明文) 迁移为 bcrypt(SHA-256 摘要)。
 * 用法（在项目根目录）：
 *   node apps/server/scripts/rehash-user-password.mjs user@example.com yourPlainPassword
 */

import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';

const email = process.argv[2];
const plainPassword = process.argv[3];

if (!email || !plainPassword) {
  console.error('用法: node apps/server/scripts/rehash-user-password.mjs <email> <plainPassword>');
  process.exit(1);
}

const digest = createHash('sha256').update(plainPassword, 'utf8').digest('hex');
const newHash = await bcrypt.hash(digest, 10);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/syncbox',
});

await client.connect();
const res = await client.query(
  'UPDATE users SET password = $1 WHERE email = $2 RETURNING id, email',
  [newHash, email],
);
await client.end();

if (res.rowCount === 0) {
  console.error('未找到用户:', email);
  process.exit(1);
}

console.log('已迁移密码摘要存储:', res.rows[0].email, res.rows[0].id);
console.log('SHA-256 摘要:', digest);
