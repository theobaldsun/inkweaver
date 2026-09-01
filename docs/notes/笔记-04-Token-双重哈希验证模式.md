> 笔记 #4：Token 双重哈希验证模式（SHA-256 快筛 + bcrypt 慢验）。本笔记关联项目代码 `apps/server/src/modules/auth/` 下 session 实体与 `validateRefreshToken` 实现。

## 笔记 #4：Token 双重哈希验证模式（SHA-256 快筛 + bcrypt 慢验）

**日期**：2026-08-14
**触发场景**：修复 Refresh Token 验证性能问题（全量 bcrypt 扫描）时，设计并实现了"快筛 + 慢验"的双重哈希验证方案。

---

### 一、问题背景

`validateRefreshToken` 在验证 refresh token 时，会拉取该用户全部活跃会话，逐条执行 `bcrypt.compare`。bcrypt 设计为慢哈希（~100ms/次），当用户有大量会话时（如多设备登录或被恶意灌入），单次 token 刷新可能需要数十秒甚至超时。

### 二、双重哈希策略

```
用户提交 refreshToken
    │
    ├── Step 1: SHA-256 快筛（索引查询）
    │     │
    │     │  createHash('sha256').update(refreshToken).digest('hex')
    │     │
    │     │  SELECT * FROM sessions
    │     │  WHERE userId = ? AND refreshTokenLookup = ?  -- O(1) 索引命中
    │     │
    │     └── 命中记录数通常为 1 条（极少可能碰撞）
    │
    └── Step 2: bcrypt 慢验（安全校验）
          │
          │  bcrypt.compare(refreshToken, candidate.refreshTokenHash)
          │
          └── 仅对命中行执行 1 次 bcrypt，确保密码学安全
```

### 三、两种哈希的角色分工

| 维度 | SHA-256（快筛） | bcrypt（慢验） |
|------|-----------------|----------------|
| **设计目标** | 快速、确定的摘要计算 | 抗暴力破解的慢哈希 |
| **耗时** | < 1ms | ~100ms（cost=10） |
| **输出确定性** | 相同输入 → 相同输出 | 相同输入 → 不同输出（随机盐） |
| **存储用途** | 数据库索引列 `refreshTokenLookup` | 安全存储列 `refreshTokenHash` |
| **角色** | 门卫点名（名单核对） | 安检员当面验身 |
| **安全性** | 不可逆但易碰撞（空间有限） | 加盐、慢计算、抗彩虹表 |

### 四、兼容性设计

历史数据迁移策略：

1. **`refreshTokenLookup` 设为 nullable**：旧会话记录没有 lookup 值，不阻塞。
2. **回退逻辑**：当 SHA-256 索引查不到时，回退全量扫描 `refreshTokenLookup IS NULL` 的旧记录。
3. **自动回填**：旧会话首次验证成功后，将 SHA-256 哈希写回 `refreshTokenLookup`，后续验证即可走索引。

```typescript
// 回退：查找 lookup 为空的历史会话
const legacySessions = await this.sessionRepository.find({
  where: { userId, refreshTokenLookup: IsNull(), ... }
});

// 命中后回填
session.refreshTokenLookup = lookup;  // 写入索引列
await this.sessionRepository.save(session);
```

### 五、性能对比

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 1 个活跃会话 | 1 次 bcrypt (~100ms) | 1 次索引 + 1 次 bcrypt (~100ms) |
| 100 个活跃会话 | 最多 100 次 bcrypt (~10s) | 1 次索引 + 1 次 bcrypt (~100ms) |
| 1000 个活跃会话 | 最多 1000 次 bcrypt (~100s) | 1 次索引 + 1 次 bcrypt (~100ms) |

关键洞察：**性能从 O(N) bcrypt 降为 O(1) 索引定位 + 1 次 bcrypt**，且安全性没有任何降低。

### 六、通用模式总结

"快筛 + 慢验"模式适用于以下场景：

- **Token 验证**：用快速哈希做索引定位，用慢哈希做安全校验
- **密码登录**：先按用户名查找，再做 bcrypt 比对（已在使用）
- **API Key 验证**：用 SHA-256 哈希做索引，用 HMAC 做完整性校验

核心原则：将 **精确匹配** 与 **安全校验** 解耦，用精确匹配缩小攻击面，用安全校验确保不可伪造。

---
