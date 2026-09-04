# PostgreSQL 数据库操作语句

本文是 InkWeaver 开发、排障和学习用的 PostgreSQL 参考。示例重点覆盖项目实际使用的 TypeORM、JSONB、数组、全文检索和 pgvector。

生产数据库默认禁止直接修改。执行 `UPDATE`、`DELETE`、DDL、migration 或恢复前，必须备份、确认目标环境，并优先在事务或隔离数据库演练。

## 1. 进入 psql

本地：

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d syncbox_db
```

生产 Compose：

```bash
cd /opt/inkweaver/repo
docker compose -p repo -f docker-compose.prod.yml --env-file .env.prod \
  exec postgres psql -U postgres -d syncbox_db
```

常用 psql 元命令：

```text
\conninfo              当前连接
\l                    数据库列表
\dn                   schema 列表
\dt                   表列表
\d documents          查看表定义
\di                   索引列表
\dx                   扩展列表
\x auto               宽记录自动纵向显示
\timing on             显示 SQL 耗时
\pset pager off        关闭分页器
\q                    退出
```

元命令没有分号；SQL 语句通常以分号结束。

## 2. 只读检查优先

```sql
SELECT current_database(), current_user, version();
SELECT now(), current_setting('TimeZone');

SELECT count(*) FROM documents;
SELECT id, title, "updatedAt"
FROM documents
WHERE "deletedAt" IS NULL
ORDER BY "updatedAt" DESC
LIMIT 20;
```

先用 `SELECT` 验证即将修改的行：

```sql
SELECT id, title
FROM documents
WHERE id = '00000000-0000-0000-0000-000000000000';
```

确认条件准确后，才把同一个 WHERE 用于 `UPDATE` 或 `DELETE`。

## 3. CRUD 基础

### INSERT

```sql
INSERT INTO example_items (id, name, created_at)
VALUES (gen_random_uuid(), '示例', now())
RETURNING *;
```

### SELECT

```sql
SELECT id, name
FROM example_items
WHERE name ILIKE '%示例%'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```

### UPDATE

```sql
UPDATE example_items
SET name = '新名称'
WHERE id = '00000000-0000-0000-0000-000000000000'
RETURNING *;
```

### DELETE

```sql
DELETE FROM example_items
WHERE id = '00000000-0000-0000-0000-000000000000'
RETURNING *;
```

InkWeaver 文档常使用软删除字段；不要把业务软删除误写成物理 `DELETE`。

## 4. 条件、排序和分页

```sql
SELECT *
FROM documents
WHERE "userId" = $1
  AND "deletedAt" IS NULL
  AND title ILIKE '%' || $2 || '%'
ORDER BY "updatedAt" DESC, id DESC
LIMIT $3 OFFSET $4;
```

| 写法 | 含义 |
|------|------|
| `=` / `<>` | 等于 / 不等于 |
| `IS NULL` | 判断 NULL；不能写 `= NULL` |
| `LIKE` | 区分大小写的模式匹配 |
| `ILIKE` | PostgreSQL 不区分大小写匹配 |
| `IN (...)` | 位于值集合 |
| `BETWEEN a AND b` | 闭区间 |
| `COALESCE(a,b)` | a 为 NULL 时使用 b |

参数 `$1`、`$2` 应由数据库驱动绑定，不能把用户输入直接拼进 SQL。

## 5. JOIN 和聚合

```sql
SELECT d.id, d.title, count(c.id) AS chunk_count
FROM documents AS d
LEFT JOIN document_chunks AS c ON c."documentId" = d.id
WHERE d."deletedAt" IS NULL
GROUP BY d.id, d.title
ORDER BY chunk_count DESC;
```

```sql
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE "deletedAt" IS NULL) AS active,
  max("updatedAt") AS latest_update
FROM documents;
```

## 6. 事务和锁

```sql
BEGIN;

SELECT id, title
FROM documents
WHERE id = $1
FOR UPDATE;

UPDATE documents
SET title = $2
WHERE id = $1;

COMMIT;
-- 出错或检查不符合预期时：ROLLBACK;
```

`BEGIN` 后未提交的事务会占用连接和锁。生产排障结束前必须明确 `COMMIT` 或 `ROLLBACK`。

查看活动连接：

```sql
SELECT pid, usename, state, wait_event_type, wait_event,
       now() - query_start AS running_for, left(query, 120) AS query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start;
```

查看非授予锁：

```sql
SELECT pid, locktype, relation::regclass, mode, granted
FROM pg_locks
WHERE NOT granted;
```

不要在不知道业务影响时直接 `pg_terminate_backend`。

## 7. PostgreSQL 类型和显式转换

```sql
SELECT pg_typeof('hello');                 -- unknown
SELECT pg_typeof('hello'::text);           -- text
SELECT pg_typeof(ARRAY['a','b']::text[]);  -- text[]
SELECT pg_typeof('{}'::jsonb);             -- jsonb
SELECT pg_typeof(to_tsvector('simple', 'hello'));
SELECT pg_typeof(plainto_tsquery('simple', 'hello'));
```

同名操作符可能存在于不同类型域。遇到 `operator does not exist` 或 `function ... does not exist`，先用 `pg_typeof` 核对左右操作数和函数参数。

## 8. 数组

```sql
SELECT ARRAY['vue', 'react']::text[];
SELECT cardinality(ARRAY['vue', 'react']::text[]); -- 2
SELECT unnest(ARRAY['vue', 'react']::text[]);
```

操作符：

```sql
SELECT ARRAY['vue','react'] @> ARRAY['vue'];        -- true，包含全部
SELECT ARRAY['vue','react'] <@ ARRAY['vue','react','ts']; -- true，被包含
SELECT ARRAY['vue','react'] && ARRAY['react','go']; -- true，存在重叠
```

`&&` 返回 `boolean`，不是交集数组。需要得到真实交集或数量时：

```sql
SELECT ARRAY(
  SELECT unnest(ARRAY['vue','react']::text[])
  INTERSECT
  SELECT unnest(ARRAY['react','go']::text[])
) AS intersection;

SELECT cardinality(ARRAY(
  SELECT unnest(ARRAY['vue','react']::text[])
  INTERSECT
  SELECT unnest(ARRAY['react','go']::text[])
)) AS intersection_count;
```

`array_length('{}'::text[], 1)` 返回 NULL；`cardinality('{}'::text[])` 返回 0。计数通常优先用 `cardinality`。

## 9. JSONB

```sql
SELECT '{"tags":["vue","react"],"active":true}'::jsonb;
```

常用操作：

```sql
SELECT '{"a":1,"b":2}'::jsonb -> 'a';       -- jsonb 1
SELECT '{"a":1,"b":2}'::jsonb ->> 'a';      -- text '1'
SELECT '{"a":1}'::jsonb @> '{"a":1}'::jsonb; -- JSON 结构包含
SELECT '["vue","react"]'::jsonb ? 'vue';
SELECT '["vue","react"]'::jsonb ?| ARRAY['go','react'];
SELECT '["vue","react"]'::jsonb ?& ARRAY['vue','react'];
```

InkWeaver 的 `documents.tags` 是 JSONB 数组，不是 PostgreSQL `varchar[]`：

```sql
-- tags 全部包含查询 token：AND 语义
tags @> to_jsonb($1::varchar[])

-- tags 至少存在一个查询 token：OR 语义
tags ?| $1::varchar[]
```

不能写：

```sql
tags && $1::varchar[]
```

`&&` 属于数组域；JSONB 没有这个操作符。

JSONB 索引：

```sql
CREATE INDEX IF NOT EXISTS idx_documents_tags_gin
ON documents USING GIN (tags);
```

索引属于 migration 管理范围，不应在生产 psql 中随手创建。

## 10. 全文检索：tsvector 与 tsquery

两种类型职责不同：

- `tsvector`：被检索文本经过分词和归一化后的词元集合。
- `tsquery`：用户查询经过解析后的查询表达式。

```sql
SELECT to_tsvector('simple', 'hello world hello');
SELECT plainto_tsquery('simple', 'hello world');
```

匹配与排序：

```sql
SELECT
  "docTsv" @@ plainto_tsquery('simple', $1) AS matched,
  ts_rank_cd("docTsv", plainto_tsquery('simple', $1)) AS rank,
  ts_headline('simple', content, plainto_tsquery('simple', $1)) AS headline
FROM documents
WHERE "docTsv" @@ plainto_tsquery('simple', $1)
ORDER BY rank DESC;
```

典型类型错误：

```sql
-- 错误：plainto_tsquery 返回 tsquery，但 tsvector_to_array 需要 tsvector
tsvector_to_array(plainto_tsquery('simple', $1))
```

如果目的是把查询文本按与文档相同配置转为词元数组，应写：

```sql
tsvector_to_array(to_tsvector('simple', $1))
```

InkWeaver 计算文档词元与查询词元的交集数量：

```sql
cardinality(
  ARRAY(
    SELECT unnest(tsvector_to_array("docTsv"))
    INTERSECT
    SELECT unnest(tsvector_to_array(to_tsvector('simple', $1)))
  )
) AS "matchedTermCount"
```

全文检索索引：

```sql
CREATE INDEX IF NOT EXISTS idx_documents_doctsv_gin
ON documents USING GIN ("docTsv");
```

## 11. pgvector

确认扩展：

```sql
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```

创建扩展由 migration 管理：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

向量列示例：

```sql
CREATE TABLE vector_example (
  id uuid PRIMARY KEY,
  embedding vector(512)
);
```

余弦距离和相似度：

```sql
SELECT
  id,
  embedding <=> $1::vector AS cosine_distance,
  1 - (embedding <=> $1::vector) AS cosine_similarity
FROM document_chunks
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

`<=>` 返回距离，值越小越接近；`1 - distance` 才是项目展示的余弦相似度，值越大越接近。

HNSW 索引参数必须使用下划线：

```sql
CREATE INDEX idx_document_chunks_embedding_hnsw
ON document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 128);
```

`efConstruction` 会被 PostgreSQL 折叠为 `efconstruction`，不是 pgvector 支持的参数；正确名称是 `ef_construction`。

查询计划：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM document_chunks
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

## 12. 搜索通道排障

InkWeaver hybrid search 包含 exact、fuzzy、related、semantic 多路候选。排障时不要只检查最终结果：

1. 确认 `documents.tags`、`docTsv` 和 `document_chunks.embedding` 的实际类型。
2. 分别运行每条 SQL，记录错误和候选数量。
3. 检查服务端是否用 `.catch(() => [])` 降级；降级必须有 `logger.warn`。
4. semantic 为空时同时检查 embedding HTTP、BullMQ 任务和 `document_chunks` 落库。
5. Top-K 只表示候选，不等于实际引用；引用还需根据相关性和模型回答中的 `[#n]` 过滤。

只统计索引覆盖率，不输出用户正文：

```sql
SELECT
  count(*) FILTER (WHERE d."deletedAt" IS NULL) AS active_documents,
  count(DISTINCT c."documentId") AS indexed_documents,
  count(c.id) AS chunks
FROM documents d
LEFT JOIN document_chunks c ON c."documentId" = d.id
WHERE d."deletedAt" IS NULL;
```

## 13. TypeORM migration

本地：

```bash
pnpm --filter @inkweaver/server migration:run
pnpm --filter @inkweaver/server migration:revert
```

生产镜像启动前由 `apps/server/docker-entrypoint.sh` 执行编译后的 migration。数据源固定 `synchronize: false`。

发布前：

1. 备份生产数据库；
2. 检查 migration 的 `up` 和 `down`；
3. 在隔离的 `pgvector/pgvector:pg16` 实例执行正向和回滚；
4. 检查扩展参数、索引、默认值、NULL 和约束；
5. 评估旧应用与新结构的兼容窗口。

跳过 migration：

```env
SKIP_MIGRATIONS=true
```

只能在已经证明数据库版本完全兼容时临时使用，不能作为迁移失败的默认绕过方案。

## 14. 备份与恢复

逻辑备份：

```bash
pg_dump -U postgres -d syncbox_db -Fc -f syncbox_db.dump
pg_restore -l syncbox_db.dump | head
```

SQL 文本备份：

```bash
pg_dump -U postgres syncbox_db | gzip > syncbox_db.sql.gz
gzip -t syncbox_db.sql.gz
```

备份成功不等于可恢复。应定期在隔离数据库执行恢复演练。

恢复会修改目标数据库，必须单独确认数据库名、备份时间点、停机窗口和回滚路径；本文不提供可直接复制到生产的无确认恢复命令。

## 15. 维护与统计

```sql
SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

```sql
VACUUM (ANALYZE) documents;
```

`VACUUM FULL` 会取得强锁并重写表，不应作为日常维护命令。

## 16. 生产安全清单

- 确认连接的是目标数据库，而不是本地同名库。
- 修改前执行对应 SELECT 并记录行数。
- 使用事务，明确 COMMIT/ROLLBACK。
- 不在终端历史中写明文密码。
- 不输出用户文档正文来做普通健康检查。
- DDL 和索引通过 migration 管理。
- migration 在隔离 PostgreSQL + pgvector 上演练。
- 应用回滚必须同时评估数据库结构兼容性。
- 数据备份与 Docker 镜像备份分开管理。

