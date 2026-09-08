> 笔记 #10：docTsv 维护方案对比与数据访问层决策。本笔记关联项目代码 `apps/server/src/modules/documents/documents.service.ts`（`updateDocument`、`projectSearchableContent`、`updateDocTsv`）、`apps/server/src/modules/auth/auth-password.controller.ts`（QueryBuilder 链式调用）。

## 笔记 #10：docTsv 维护方案对比与数据访问层决策

**日期**：2026-09-08
**触发场景**：阅读 [docs/本次问题与代码修改.md](../本次问题与代码修改.md) 2.5 节"正文与全文索引可能不一致"修复方案时，对"事务 + 两次 UPDATE"的实现提出疑问，对比三种方案（DB 触发器、原生 SQL 合并 UPDATE、当前事务+两次 UPDATE），并延伸到 QueryBuilder 与原生 SQL 的取舍原则。

---

### 一、问题背景：docTsv 为何需要特殊处理

#### 1.1 docTsv 是裸 SQL 列，不在 TypeORM 实体里

[document.entity.ts](../../apps/server/src/modules/documents/entity/document.entity.ts) 的 `Document` 类**没有声明 `docTsv` 字段**。这一列只在 migration [1756000000000-SearchInfraUpgrade.ts](../../apps/server/src/migrations/1756000000000-SearchInfraUpgrade.ts#L23) 中作为裸 SQL 添加：

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "docTsv" tsvector
```

原因：`tsvector` 类型包含权重（`setweight(..., 'A')`）、连接符（`||`）、长度截断（`left(content, 100000)`）等 PG 特定函数组合，TypeORM 实体列装饰器无法表达这种"基于其他列的计算列"语义，必须用原生 SQL 维护。

#### 1.2 当前实现：事务 + 两次 UPDATE

[documents.service.ts#L342-L353](../../apps/server/src/modules/documents/documents.service.ts#L342-L353)：

```typescript
const saved = searchableContentChanged
  ? await this.documentsRepository.manager.transaction(async (manager) => {
      const transactionalSaved = await manager.save(Document, document);  // UPDATE 1: title/content
      await this.updateDocTsv(
        transactionalSaved.id, transactionalSaved.title, transactionalSaved.content, manager,
      );  // UPDATE 2: docTsv
      return transactionalSaved;
    })
  : await this.documentsRepository.save(document);  // 无需事务：只更新非搜索字段
```

两次 UPDATE 的分工：
- UPDATE 1（`manager.save`）：维护实体字段（title、content、isPublic、tags、folderId 等），由 TypeORM 自动生成。
- UPDATE 2（`updateDocTsv`）：维护 docTsv 列，原生 SQL 执行 `to_tsvector` + `setweight` + `left` 组合表达式。

---

### 二、三种维护方案对比

#### 2.1 方案 A：DB 触发器（被否决）

**实现思路**：迁移加一个 BEFORE INSERT OR UPDATE 触发器，让数据库自动维护 docTsv。

```sql
CREATE TRIGGER documents_docTSV_trigger
BEFORE INSERT OR UPDATE OF title, content ON documents
FOR EACH ROW EXECUTE FUNCTION documents_docTSV_maintain();
```

**优点**：
- 应用层零代码，所有更新路径自动维护
- 一致性最强（DB 层永远一致）

**缺点**：
- **高强度写入场景下 DB CPU 压力大**：本项目是文档型软件，编辑会高频触发 UPDATE。触发器在每次 UPDATE 时都执行 `to_tsvector` 计算，且无法在应用层判断"内容是否真的变了"——即使只改 tags，触发器也会算（除非用 `OF title, content` 限定，但仍占 DB CPU）。
- 数据库崩溃或维护窗口期间触发器失效，应用层无兜底
- 跨数据库不可移植（但本项目已强依赖 pgvector，无需移植）

**结论**：本项目是高强度写入的文档型软件，**把数据库搞崩反而得不偿失**，否决触发器方案。

#### 2.2 方案 B：原生 SQL 合并 UPDATE（被否决）

**实现思路**：动态构建 SET 子句，把 title/content 和 docTsv 合并到一条 UPDATE。

```typescript
const sql = `
  UPDATE documents
  SET title = $2, content = $3,
      "docTsv" = setweight(to_tsvector('simple', COALESCE($2, '')), 'A')
              || setweight(to_tsvector('simple', left(COALESCE($3, ''), 100000)), 'D'),
      "updatedAt" = NOW()
  WHERE id = $1
`;
await this.documentsRepository.query(sql, [docId, title, content]);
```

**优点**：
- 单条 UPDATE 原子性保证，**无需显式事务**
- 减少 round-trip（1 次 vs 2 次）
- 应用层可控：`searchableContentChanged` 判断后完全跳过 tsvector 计算

**缺点**：
- 放弃 TypeORM 实体能力：`@UpdateDateColumn` 自动维护 `updatedAt` 失效、hook 钩子、订阅者、级联关系等
- 字段维护成本翻倍：实体类每加一列，原生 SQL 都要手动同步加列
- 与 `projectSearchableContent` 等其他更新路径不一致
- 仅节省"同事务同连接下的一次 round-trip"（几毫秒），收益有限

**结论**：原生 SQL 虽然省去了事务和两次更新，但牺牲了 ORM 的自动化能力，**不优雅且后期维护成本高**。本项目当前实现虽然复杂但没有 bug，改造成本 vs 收益不划算，列入技术债清单暂不动。

#### 2.3 方案 C：当前实现 事务+两次 UPDATE（保留）

**优点**：
- TypeORM 实体能力完整保留（`@UpdateDateColumn`、字段类型安全、自动 SQL 生成）
- 与项目其他模块（[search.service.ts](../../apps/server/src/modules/search/search.service.ts)、[folders.service.ts](../../apps/server/src/modules/documents/folders.service.ts)）的 QueryBuilder 风格一致
- 显式事务保证一致性：title/content 与 docTsv 要么都成功要么都回滚

**缺点**：
- 两次 round-trip（同事务同连接，开销有限）
- 事务开销（PG 事务是轻量的，但仍有 BEGIN/COMMIT 成本）
- `searchableContentChanged` 时才走事务，无内容更新跳过

**结论**：本项目当前实现是正确的，已通过 [documents.service.test.ts](../../apps/server/src/modules/documents/documents.service.test.ts) 验证。**性能影响在可接受范围内**，一致性目标完全达成，保留现状。

---

### 三、QueryBuilder vs 原生 SQL 的取舍原则

延伸讨论：[auth-password.controller.ts#L92-L101](../../apps/server/src/modules/auth/auth-password.controller.ts#L92-L101) 的 `resetPassword` 用 QueryBuilder 链式调用，是否应改为原生 SQL？

```typescript
const result = await manager
  .createQueryBuilder()
  .update(PasswordResetToken)
  .set({ usedAt: now })
  .where('"tokenHash" = :tokenHash', { tokenHash })
  .andWhere('"usedAt" IS NULL')
  .andWhere('"expiresAt" > :now', { now })
  .returning(['userId'])
  .execute();
```

vs 原生 SQL：

```typescript
const result = await manager.query(
  `UPDATE "password_reset_tokens"
   SET "usedAt" = $1
   WHERE "tokenHash" = $2 AND "usedAt" IS NULL AND "expiresAt" > $1
   RETURNING "userId"`,
  [now, tokenHash],
);
```

#### 3.1 取舍维度

| 维度 | QueryBuilder | 原生 SQL |
|---|---|---|
| 表名同步 | 自动从实体拿（`@Entity('password_reset_tokens')` 改名时跟随） | 手写字符串，要全仓搜索改 |
| 类型提示 | `.set({ usedAt: now })` 编译期校验字段名和值类型 | 字符串，错了运行时才发现 |
| 字段映射 | 自动处理 camelCase→snake_case | 手写引号包裹 |
| 跨数据库 | 理论上可适配其他 DB | PG 专属 |
| 可读性 | 链式意图清晰 | SQL 一目了然 |
| 学习成本 | 要懂 TypeORM QueryBuilder API | 懂 SQL 就行 |
| 行数 | 较多 | 较少 |

#### 3.2 决策原则

**QueryBuilder 的不可替代场景**：
- 需要 `.returning()` 显式声明 RETURNING 字段（TypeORM 普通 `manager.update` 默认只有 `affected`）
- 需要 TypeORM 自动维护 `@UpdateDateColumn` 等装饰器行为
- 实体频繁加列时希望 SQL 自动跟随

**原生 SQL 的不可替代场景**：
- 维护 TypeORM 实体看不见的裸 SQL 列（如 docTsv 的 tsvector 表达式）
- 复杂的 PG 特定函数组合（`to_tsvector` + `setweight` + `left`）
- 性能敏感路径需要减少 round-trip

#### 3.3 本项目的统一原则

- **优先 QueryBuilder**：与项目其他模块风格一致，类型安全，维护点集中
- **仅在 ORM 实体看不见的裸 SQL 列才用 `manager.query()`**：如 docTsv
- **不混用**：同一路径如果已经开始用 QueryBuilder，不要中途切到原生 SQL

[auth-password.controller.ts](../../apps/server/src/modules/auth/auth-password.controller.ts) 的 QueryBuilder 写法虽然冗长，但带来三个实实在在的维护收益：
1. 表名/字段名自动同步实体
2. 类型提示（`.set({ usedAt: now })` 编译期校验）
3. 与项目其他模块风格一致

混用反而增加认知负担，保留 QueryBuilder。

---

### 四、技术债清单

基于本次评审，记录以下技术债（暂不修改，待后续迭代处理）：

| 技术债 | 当前状态 | 触发条件 | 处理建议 |
|---|---|---|---|
| `updateDocument` 事务+两次 UPDATE | 正确，通过测试 | 高强度写入场景累积开销显著 | 改为原生 SQL 合并 UPDATE，需统一改造 `projectSearchableContent` 和 `createDocument` |
| `resetPassword` QueryBuilder 链式调用 | 正确，冗长 | 代码风格统一性整改时 | 保留，与项目其他模块一致 |
| docTsv 维护机制分散在 3 处调用 | 正确，但易遗漏新增更新路径 | 新增文档更新入口忘记调 `updateDocTsv` | 改为 DB 触发器或 STORED 生成列（PG 12+） |

---

### 五、关键概念速查

| 概念 | 含义 | 关联代码 |
|---|---|---|
| `tsvector` | PG 全文检索列类型，存储词素和权重 | `documents.docTsv` |
| `setweight` | 给 tsvector 设置权重（A 最高，D 最低） | `updateDocTsv` |
| `to_tsvector('simple', ...)` | 简单分词（不依赖词典），适合中英文混合 | `updateDocTsv` |
| `left(text, 100000)` | 截断到 10 万字符，避免超长文档拖慢 tsvector 构建 | `updateDocTsv` |
| `@UpdateDateColumn` | TypeORM 装饰器，自动维护 `updatedAt` | `document.entity.ts#L63` |
| `pessimistic_write` | TypeORM 行锁模式，对应 PG `FOR UPDATE` | 详见 [笔记-02](./笔记-02-TOCTOU-竞态与数据库锁机制.md) |
| QueryBuilder `.returning()` | 显式声明 PG RETURNING 字段 | `auth-password.controller.ts#L99` |

---

### 六、教训

1. **裸 SQL 列必须显式维护**：TypeORM 实体看不见的列（如 tsvector）必须用原生 SQL 单独维护，且维护点要集中、覆盖所有更新路径。
2. **事务边界对一致性至关重要**：跨列的关联更新（title/content 与 docTsv）必须同事务，避免部分成功导致搜索与正文不一致。
3. **方案选择要考虑负载特征**：DB 触发器在低写入场景可能合适，但高强度写入的文档型软件会把 CPU 压力转移到 DB，得不偿失。
4. **代码风格一致性 > 局部简洁性**：QueryBuilder 虽然冗长，但与项目其他模块一致带来的可维护性收益大于原生 SQL 的局部简洁性。混用反而增加认知负担。
5. **技术债要显式记录**：评审中识别的优化点即使暂不修改，也要记录到技术债清单，避免后续维护时重复分析。

---
