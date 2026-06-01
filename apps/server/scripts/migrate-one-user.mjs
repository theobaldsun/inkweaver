/**
 * 查询并迁移单个用户密码为 bcrypt(SHA-256 摘要)。
 */
import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';

const emailArg = process.argv[2];
const plainPassword = process.argv[3];
const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USERNAME || 'root'}:${process.env.DB_PASSWORD || '123456'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_DATABASE || 'postgres_db'}`;

if (!emailArg || !plainPassword) {
  console.error('用法: node migrate-one-user.mjs <email> <plainPassword>');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

const candidates = [emailArg];
if (emailArg.includes(',com')) {
  candidates.push(emailArg.replace(',com', '.com'));
}
if (emailArg.includes('.com') && !emailArg.includes(',com')) {
  candidates.push(emailArg.replace('.com', ',com'));
}

let user = null;
for (const email of [...new Set(candidates)]) {
  const found = await client.query('SELECT id, email FROM users WHERE email = $1', [email]);
  if (found.rowCount > 0) {
    user = found.rows[0];
    break;
  }
}

if (!user) {
  const like = await client.query(`SELECT id, email FROM users WHERE email LIKE 'root@ink%'`);
  console.error('未找到用户。尝试的邮箱:', candidates.join(', '));
  if (like.rowCount > 0) {
    console.error('相似账号:', like.rows.map((r) => r.email).join(', '));
  }
  await client.end();
  process.exit(1);
}

const digest = createHash('sha256').update(plainPassword, 'utf8').digest('hex');
const newHash = await bcrypt.hash(digest, 10);

await client.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);
await client.end();

console.log('迁移成功');
console.log('  邮箱:', user.email);
console.log('  用户 ID:', user.id);
console.log('  SHA-256 摘要:', digest);
