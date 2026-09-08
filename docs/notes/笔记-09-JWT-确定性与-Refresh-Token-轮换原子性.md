> 笔记 #9：JWT 确定性与 Refresh Token 轮换原子性。本笔记关联项目代码 `apps/server/src/modules/auth/session.service.ts`（`rotateRefreshToken`）与 `apps/server/src/modules/auth/auth.service.ts`（`generateRefreshToken`）。与 [笔记-04 Token 双重哈希验证模式](./笔记-04-Token-双重哈希验证模式.md) 互为补充：#4 讲"验证"阶段的快筛+慢验，#9 讲"轮换"阶段的原子性与唯一性。

## 笔记 #9：JWT 确定性与 Refresh Token 轮换原子性

**日期**：2026-09-08
**触发场景**：阅读 [docs/本次问题与代码修改.md](../本次问题与代码修改.md) 2.2 节"Refresh Token 轮换不可靠"修复方案时，深入剖析三个根因（非原子轮换、并发重复消费、同秒签发相同 token）背后的技术原理，以及修复方案中 `jti`、`pessimistic_write` 行锁、条件更新三个机制的协同。

---

### 一、问题背景：轮换的三重失效

Refresh Token 轮换的预期是：旧 Token 一次性消费、新 Token 生效、攻击者截获的旧 Token 失效。原始实现存在三个失效路径：

| 失效路径 | 触发条件 | 后果 |
|---|---|---|
| 字段非原子更新 | 哈希/查询哈希/有效期分散更新 | 部分字段更新成功、部分失败，状态不一致 |
| 并发重复消费 | 多请求同时通过 JWT 校验 | 多个请求都把旧 Token 当作有效，各自轮换 |
| 同秒签发相同 token | JWT Payload 固定 + iat 秒级精度 | 新旧 Token 字符串相同，轮换前后没区别 |

前两个属于"并发控制"问题（参考 [笔记-02 TOCTOU 竞态与数据库锁机制](./笔记-02-TOCTOU-竞态与数据库锁机制.md)），第三个属于"JWT 确定性"问题，单独成章。

---

### 二、JWT 确定性：为什么同秒签发会"撞 token"

#### 2.1 JWT 是确定性签名，不是随机数

JWT 的签名过程是**确定性**的：

```
Header（base64） + "." + Payload（base64） + "." + HMAC-SHA256(secret, Header + "." + Payload)
```

给定：
- 相同的 Payload
- 相同的密钥
- 相同的算法

输出的 JWT 字符串**完全相同**。这与"随机数 token"（如 `crypto.randomBytes(32).toString('hex')`）有本质区别。

#### 2.2 Payload 中影响唯一性的字段

JWT 标准 Payload 中，可能影响签名的字段：

| 字段 | 含义 | 精度/熵源 |
|---|---|---|
| `sub` | 用户 ID | 固定（同一用户） |
| `email` | 邮箱 | 固定 |
| `type` | 'access' / 'refresh' | 固定 |
| `iat` | 签发时间 | **秒级精度**，同一秒内值相同 |
| `exp` | 过期时间 | 由 iat + expiresIn 推导，秒级精度 |
| `jti` | 唯一 ID | 默认不生成 |

本项目的 `generateRefreshToken` 原始实现：

```typescript
// apps/server/src/modules/auth/auth.service.ts
async generateRefreshToken(user: User): Promise<string> {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    type: 'refresh',
  };
  return this.jwtService.sign(payload, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  });
}
```

Payload 中只有 `sub`、`email`、`type`，外加框架自动注入的 `iat`、`exp`。**同一秒内对同一用户签发的 refresh token 字符串完全相同**。

#### 2.3 撞 token 如何破坏轮换

```
T=1694123456s  第一次刷新：
  payload = { sub:"u1", email:"x@y.z", type:"refresh", iat:1694123456 }
  JWT A = "eyJhbG...签名X"

T=1694123456s  第二次刷新（同秒）：
  payload = { sub:"u1", email:"x@y.z", type:"refresh", iat:1694123456 }
  JWT B = "eyJhbG...签名X"   ← 与 A 完全相同

轮换流程：
  sessions.refreshTokenLookup: sha256(A) → sha256(B)  （没变）
  sessions.refreshTokenHash:    bcrypt(A) → bcrypt(B)   （没变）

结果：数据库里存的哈希根本没变，旧 Token A 永久有效
```

更糟的是：两个并发请求都拿 A 换 B（B===A），两个条件更新都能命中（因为 lookup 值不变），原本设计 `result.affected !== 1` 防并发的机制完全失效。

#### 2.4 修复方案：注入随机 `jti`

```typescript
// apps/server/src/modules/auth/auth.service.ts#L112-L123
async generateRefreshToken(user: User): Promise<string> {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    type: 'refresh',
  };
  return this.jwtService.sign(payload, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    jwtid: randomUUID(),   // 注入随机 jti
  });
}
```

Payload 变成：

```
{ sub:"u1", email:"x@y.z", type:"refresh", iat:1694123456, jti:"a1b2c3..." }
```

- 同秒签发两次 → `jti` 不同 → Payload 不同 → JWT 字符串不同
- 轮换后 `refreshTokenLookup` 真的从 `sha256(A)` 变成 `sha256(B)`
- 旧 Token A 的 lookup 在数据库中已不存在，条件更新必然 `affected = 0`

#### 2.5 通用原则

任何依赖"新生成的 token 与旧 token 不同"的逻辑，**必须确保 token 生成有足够熵源**。JWT 的熵完全来自 Payload 中可变字段的熵，`iat` 秒级精度不足以打破确定性，需要：
- `jti`（标准做法）
- 或在 Payload 里塞 `crypto.randomBytes(...)` 
- 或干脆不用 JWT 做 refresh token，改用 `crypto.randomBytes(32).toString('hex')`（随机数 token）

本项目保留 JWT 是为了复用 `verifyToken` 的过期校验和签名校验能力，所以选择加 `jti`。

---

### 三、轮换原子性：事务 + 行锁 + 条件更新

#### 3.1 三个机制的协同

[session.service.ts#L124-L201](../../apps/server/src/modules/auth/session.service.ts#L124-L201) 的 `rotateRefreshToken` 用三个机制叠加保证原子性：

```typescript
return this.sessionRepository.manager.transaction(async (manager) => {
  // 机制 1：pessimistic_write 行锁
  let session = await manager.findOne(Session, {
    where: { userId, status: SessionStatus.ACTIVE, expiresAt: MoreThan(now), refreshTokenLookup: oldLookup },
    lock: { mode: 'pessimistic_write' },
  });

  // bcrypt 校验
  if (!session || !(await bcrypt.compare(refreshToken, session.refreshTokenHash))) {
    throw new UnauthorizedException('无效的刷新令牌');
  }

  // 机制 2：条件更新（WHERE refreshTokenLookup = oldLookup）
  const result = await manager.update(
    Session,
    { id: session.id, userId, status: SessionStatus.ACTIVE, refreshTokenLookup: legacy ? IsNull() : oldLookup },
    { refreshTokenHash: newHash, refreshTokenLookup: newLookup, expiresAt, lastActivityAt: now },
  );
  // 机制 3：affected 行数校验
  if (result.affected !== 1) {
    throw new UnauthorizedException('刷新令牌已被使用');
  }
});
```

#### 3.2 三机制的分工

| 机制 | 防御的攻击 | 局限 |
|---|---|---|
| 事务 | 部分字段更新失败导致状态不一致 | 不能防并发，只防"部分成功" |
| `pessimistic_write` 行锁 | 并发请求同时通过 JWT 校验后争抢同一行 | 锁粒度按行，不阻塞其他用户 |
| 条件更新 `WHERE lookup=old` | 即使绕过锁（如锁释放后第二个请求到达），也能用 SQL 层条件阻止重复消费 | 需要应用层检查 `affected` |
| `affected !== 1` | 把"条件未命中"转译成 401 异常 | 仅在事务内有效 |

#### 3.3 为什么需要三层防御

- **只用事务**：能保证字段原子性，但两个并发事务都能"看到"旧 Token 有效，各自更新成功。
- **只用行锁**：串行化两个请求，但锁释放后第二个请求仍然能用旧 Token 二次消费（因为它读到的 session 行 lookup 还是 oldLookup，没有被第一个请求覆盖到——除非事务已提交）。事实上 `pessimistic_write` 会阻塞到事务结束，但显式条件更新仍是兜底。
- **只用条件更新**：理论上够（PG 的 UPDATE 是行级原子），但缺少事务会导致"密码改了但 session 没撤销"等部分成功。

三层叠加才覆盖所有路径：事务保证字段原子性，行锁串行化并发，条件更新兜底防重复消费。

#### 3.4 兼容历史数据的回退路径

[session.service.ts#L151-L169](../../apps/server/src/modules/auth/session.service.ts#L151-L169) 对 `refreshTokenLookup IS NULL` 的旧记录做 bcrypt 扫描回退，命中后回填 lookup。这是一次性迁移逻辑：

```typescript
let legacy = false;
if (!session) {
  const legacySessions = await manager.find(Session, {
    where: { userId, status: SessionStatus.ACTIVE, expiresAt: MoreThan(now), refreshTokenLookup: IsNull() },
  });
  for (const candidate of legacySessions) {
    if (await bcrypt.compare(refreshToken, candidate.refreshTokenHash)) {
      session = candidate;
      legacy = true;
      break;
    }
  }
}
// 条件更新时区分新旧路径
refreshTokenLookup: legacy ? IsNull() : oldLookup,
```

迁移完成后所有活跃会话都有 lookup，回退分支不再触发。

---

### 四、为什么刷新接口只校验 refresh_token

#### 4.1 双令牌的职责分工

| 令牌 | 用途 | 有效期 | 是否查库 | 可撤销 |
|---|---|---|---|---|
| access_token | 访问业务 API | 短（15min~1h） | 不查（无状态） | 难（只能等过期） |
| refresh_token | 换取新 access_token | 长（30 天） | **必须查 sessions 表** | 可以（撤销会话） |

[auth.controller.ts#L35-L37](../../apps/server/src/modules/auth/auth.controller.ts#L35-L37) 的 `/api/auth/refresh` 入参 DTO 只有一个字段：

```typescript
export class RefreshTokenDto {
  @IsString()
  refresh_token!: string;
}
```

#### 4.2 为什么不能同时校验 access_token

1. **职责倒置**：access_token 是无状态短期凭证，泄露最多用到过期；如果它能换 refresh_token，等于把短期不可撤销令牌升级成长期可用令牌，扩大攻击面。
2. **静默续期失效**：客户端常见模式是 access_token 过期后用 refresh_token 换新的，强制要求 access_token 有效会让这个流程无法工作。
3. **无状态性破坏**：access_token 不查库是为了业务 API 性能（每请求不查库），如果用它做轮换凭证，服务端必须查库验证撤销状态，破坏了无状态设计。

#### 4.3 流程

```
客户端 POST /api/auth/refresh { refresh_token: 旧R }
  ↓
1. verifyToken(旧R)              → JWT 签名校验
2. payload.type === 'refresh'    → 类型校验
3. requireUserById(payload.sub)  → 用户存在性校验
4. 生成 新A、新R（Promise.all 并行）
5. rotateRefreshToken(旧R, userId, 新R)  ← 三机制原子轮换
6. 返回 { access_token: 新A, refresh_token: 新R }
```

`access_token` 是**输出**，不是**输入**。校验用户身份合法性的职责完全由旧 refresh_token 承担（JWT 签名 + 数据库会话状态 + bcrypt 哈希三重校验）。

---

### 五、关键概念速查

| 概念 | 含义 | 关联代码 |
|---|---|---|
| JWT 确定性 | 相同 Payload+密钥+算法 → 相同字符串 | `auth.service.ts#L119` |
| `jti` | JWT 唯一 ID claim，打破确定性 | `auth.service.ts#L121` |
| `iat` | JWT 签发时间，秒级精度 | 框架自动注入 |
| `pessimistic_write` | TypeORM 行锁模式（对应 PG `FOR UPDATE`） | `session.service.ts#L148` |
| 条件更新 | UPDATE 的 WHERE 子句包含原值，未命中即已被消费 | `session.service.ts#L175-L189` |
| `affected !== 1` | TypeORM 返回的影响行数，用于检测条件更新命中 | `session.service.ts#L190` |
| SHA-256 lookup | 快速定位列，详见 [笔记-04](./笔记-04-Token-双重哈希验证模式.md) | `session.entity.ts#L57-L59` |

---

### 六、教训

1. **JWT 不是随机数**：任何依赖"新生成 token 与旧 token 不同"的逻辑，必须确保 token 生成有足够熵源。JWT 的 `iat` 秒级精度不足，必须加 `jti` 或在 Payload 塞随机量。
2. **轮换的三个失效路径需要三层防御**：事务防部分成功，行锁防并发争抢，条件更新防锁释放后二次消费。任何一层缺失都有漏洞。
3. **职责分层不能倒置**：无状态的 access_token 不能用于轮换有状态的 refresh_token。短期不可撤销令牌不能升级成长期可用令牌。
4. **兼容性设计**：新增索引列时设 `nullable: true`，对旧记录走回退分支，命中后回填，一次性迁移。详见 [笔记-04 第四节](./笔记-04-Token-双重哈希验证模式.md#四兼容性设计)。

---
