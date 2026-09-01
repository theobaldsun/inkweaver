> 笔记 #2：TOCTOU 竞态与数据库锁机制。本笔记关联项目代码 `apps/server/src/modules/sync/sync.controller.ts`（push 接口的事务 + 悲观锁实现）。

## 笔记 #2：TOCTOU 竞态与数据库锁机制

**日期**：2026-08-12
**触发场景**：修复 SRV-P1-06（sync push TOCTOU 竞态）时，深入理解协作编辑场景下的并发控制策略。

---

### 一、问题本质：什么是 TOCTOU？

TOCTOU（**Time-of-Check to Time-of-Use**）是一种经典的并发漏洞类型：

```
检查资源状态 (Check) → [时间窗口，状态可能被其他操作修改] → 使用资源 (Use)
```

在这段时间窗口内，资源状态被其他并发操作修改，导致之前的检查结论失效。

#### 在 Sync Push 场景的具体表现

Yjs 同步机制回顾：
- 客户端每次发送更新（Update）时，附带 `baseUpdateId`（表示"基于服务端第 N 个版本做的修改"）
- 服务端检查逻辑：`serverLatestUpdateId > baseUpdateId` → 返回 **409 Conflict** 让客户端先同步

竞态发生条件：
1. Client A（base=5）和 Client B（base=5）**同时**发送更新
2. 两个请求几乎同时执行 `SELECT MAX(updateId)`，都读到 `latest = 5`
3. 两个请求都判断：`5 > 5`? **NO** → 都认为"无冲突"
4. 两个请求都执行 INSERT，生成 ID 6 和 7

后果：
- Client B 基于版本 5 的更新，实际上与 Client A 的更新是**并发冲突**
- 但服务端错误接受了两者，没有返回 409
- Yjs CRDT 虽然能合并并发更新，但 **baseUpdateId 的乐观锁契约被破坏**

---

### 二、时序图：竞态如何发生

#### 修复前（TOCTOU 竞态）

```
时间 →
────────────────────────────────────────────────────────────────
Client A (baseId=5)    Server DB          Client B (baseId=5)
────────────────────────────────────────────────────────────────
① 查询 latestId ──────► 返回 5
                                            ② 查询 latestId ──────► 返回 5
③ 检查: 5 > 5? NO ✓
                                            ④ 检查: 5 > 5? NO ✓
⑤ 保存更新 → ID: 6
                                            ⑥ 保存更新 → ID: 7
                                            
←─────────── 两个请求都通过了冲突检测！───────────
```

#### 修复后（事务 + 悲观锁）

```
时间 →
────────────────────────────────────────────────────────────────
Client A (baseId=5)    Server DB          Client B (baseId=5)
────────────────────────────────────────────────────────────────
① 开启事务
② SELECT ... FOR UPDATE ──► 获取锁
                                            等待锁释放 ⏳
③ 查询 latestId = 5
④ 检查: 5 > 5? NO ✓
⑤ 保存 → ID: 6
⑥ 提交事务，释放锁
                                            🔒 获取锁成功
                                            ⑦ 查询 latestId = 6
                                            ⑧ 检查: 6 > 5? YES ❌
                                            ⑨ 回滚，返回 409 Conflict
```

**关键**：`SELECT ... FOR UPDATE` 让 B 在 A 提交后才能读取数据，此时 latestId 已变为 6，正确检测到冲突。

---

### 三、解决方案对比

| 方案 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| **悲观锁** | 先加锁再操作，串行化执行 | 简单直接，保证强一致性 | 锁竞争，可能阻塞 | 写多、冲突率高（协作编辑） |
| **乐观锁** | 假设无冲突，冲突时回滚重试 | 无锁，高并发性能好 | 需重试逻辑，实现复杂 | 写少、冲突率低（用户资料） |
| **唯一约束 + 重试** | 利用 DB 唯一键约束保证原子性 | 无需显式锁 | 需处理唯一键冲突异常 | 可区分业务冲突的场景 |

#### 为什么选择悲观锁？

**协作编辑场景特点**：
- 高频写操作（每个按键都是一次更新）
- 中等冲突率（多人同时编辑同一文档）
- 需要强一致性（不能丢失任何更新）

在这种场景下：
1. 悲观锁的开销（~5ms/次）远低于乐观锁的重试成本
2. 文档级粒度锁，不同文档完全并行，不影响吞吐量
3. 实现简单，逻辑清晰，易于维护

---

### 四、关键代码实现

#### DataSource 注入

```typescript
// sync.controller.ts
import { Repository, DataSource, EntityManager } from 'typeorm';

@Controller('sync')
export class SyncController {
  constructor(
    @InjectRepository(SyncUpdate)
    private syncUpdateRepository: Repository<SyncUpdate>,
    // ... 其他依赖
    private readonly dataSource: DataSource,  // ← 新增注入
  ) {}
}
```

#### 事务化改造

```typescript
@Post('/push')
async push(@Body() dto: PushDto, @Request() req: ExpressRequest) {
  const { docId, updates, clientId, baseUpdateId } = dto;
  const userId = getUserId(req.user);

  await this.documentsService.assertDocumentActive(docId, userId);
  assertValidSyncUpdates(updates);

  // 🔑 关键：事务包裹
  const { savedUpdates, latestSavedUpdate } = await this.dataSource.transaction(
    async (manager: EntityManager) => {
      // ① 加锁 + 查询最新更新 ID
      const latestUpdate = await manager.findOne(SyncUpdate, {
        where: { docId },
        order: { updateId: 'DESC' },
        select: ['updateId'],
        lock: { mode: 'pessimistic_write' },  // ← SELECT ... FOR UPDATE
      });

      const serverLatestUpdateId = latestUpdate?.updateId || 0;

      // ② 冲突检测
      if (baseUpdateId !== undefined && serverLatestUpdateId > baseUpdateId) {
        throw new HttpException(
          { docId, latestUpdateId: serverLatestUpdateId, message: 'Client is behind server version' },
          HttpStatus.CONFLICT,
        );
      }

      // ③ 保存所有更新
      const savedUpdates: SyncUpdate[] = [];
      for (const update of updates) {
        const syncUpdate = manager.create(SyncUpdate, {
          docId,
          update,
          timestamp: Date.now(),
          clientId,
        });
        const saved = await manager.save(syncUpdate);
        savedUpdates.push(saved);
      }

      return {
        savedUpdates,
        latestSavedUpdate: savedUpdates[savedUpdates.length - 1]?.updateId || serverLatestUpdateId,
      };
    },
  );

  // ④ 副作用在事务外执行（避免长事务）
  this.syncGateway.broadcastDocUpdates(docId, updates, updateIds, clientId);
  this.storageUsageService.scheduleRecalculateByDocId(docId);
  this.snapshotService.scheduleSnapshot(docId);

  return { success: true, updateIds, latestUpdateId: latestSavedUpdate };
}
```

#### `lock: 'pessimistic_write'` 做了什么？

TypeORM 会将其转换为 SQL：
```sql
SELECT "updateId" 
FROM "sync_update" 
WHERE "docId" = $1 
ORDER BY "updateId" DESC 
LIMIT 1 
FOR UPDATE  -- 🔒 排他锁，其他事务无法读取/修改这行
```

锁会在 `COMMIT` 或 `ROLLBACK` 时释放。

---

### 五、性能分析：会成为瓶颈吗？

#### 核心结论：在绝大多数协作场景下不会

**阻塞粒度**：文档级（不同文档完全并行）
**事务耗时**：仅 5-10ms（1次 SELECT + 1次 INSERT）

#### 吞吐量估算

| 同时编辑同一文档的人数 | 最后一人的等待时间 | 用户感知 |
|---|---|---|
| 5 人 | ~50ms | **完全无感知** |
| 20 人 | ~200ms | 轻微延迟，可接受 |
| 50 人 | ~500ms | 明显卡顿 |
| 100 人 | ~1000ms | 严重阻塞 |

**实际场景**：5 人同时编辑一个文档已是高频协作，百人同时编辑属于极端活动场景。

#### 为什么副作用在事务外？

```typescript
// 这些操作不参与原子性，放在事务外
syncGateway.broadcastDocUpdates(...);     // WebSocket 广播
storageUsageService.scheduleRecalculate...();  // 存储统计
snapshotService.scheduleSnapshot(...);    // 快照生成
```

**原因**：
1. 广播涉及 WebSocket I/O，可能耗时
2. 快照、存储统计是异步调度，不需要事务保护
3. 长事务占用数据库连接和锁资源，降低并发能力
4. 数据持久化（INSERT）成功后，后续操作失败不影响数据一致性

---

### 六、扩展知识：TypeORM 锁类型

| 锁类型 | SQL 语句 | 行为 |
|--------|---------|------|
| `read` | `LOCK IN SHARE MODE` | 共享锁，允许其他事务读取 |
| `pessimistic_write` | `FOR UPDATE` | 排他锁，阻止其他事务读取/修改 |
| `no_key_update` | `FOR NO KEY UPDATE` | 不阻塞其他事务的 `FOR KEY SHARE` |
| `pessimistic_partial_write` | `FOR SHARE` (PostgreSQL) | 部分排他锁 |

**选择依据**：
- 只需要"读-判-写"原子性 → `pessimistic_write`
- 多个事务可以同时读取，需要防止并发修改 → `read`（共享锁）

---

### 教训

1. **"读-判-写"模式必须原子化**：任何涉及"读取状态 → 检查条件 → 执行操作"的逻辑，如果三个步骤不在同一事务中，就存在 TOCTOU 风险
2. **锁的粒度决定性能**：文档级锁（非全局锁）是协作编辑的关键设计——不同文档的编辑请求完全并行
3. **副作用与事务分离**：耗时操作（广播、缓存、快照）应在事务提交后执行，避免长事务
4. **Yjs CRDT ≠ 业务层无需锁**：CRDT 解决了数据合并问题，但业务层的冲突检测（baseUpdateId）仍需要数据库锁保证原子性
5. **悲观锁在高并发写场景下反而更优**：乐观锁在冲突率高时需要大量重试，反而比直接加锁等待更慢

---
