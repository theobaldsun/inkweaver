# 问题记录

已验证的问题根因与修复方案。每条记录包含现象、根因、修复方式和验证标准，避免重复排障。

---

## #1 嵌入服务无法下载 HuggingFace 模型

- **日期**：2026-07-31
- **模块**：`services/embed-service`
- **现象**：启动 embed-service 后调用 `/embed` 返回 500，日志报 `OSError: We couldn't connect to 'https://huggingface.co'`
- **根因**：国内网络无法直接访问 HuggingFace 主站，`sentence-transformers` 默认从 `huggingface.co` 下载模型
- **修复**：在 `services/embed-service/app.py` 中，于 `sentence_transformers` 导入前设置镜像：
  ```python
  os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
  ```
- **验证**：启动服务后 `GET /health` 返回 200，首次 `/embed` 请求模型下载成功

---

## #2 迁移报 extension "vector" is not available

- **日期**：2026-07-31
- **模块**：`apps/server` 迁移
- **现象**：执行 `migration:run` 时，`AddDocumentChunksPgvector` 迁移失败，报 `extension "vector" is not available`
- **根因**：PostgreSQL 容器使用了普通 `postgres` 镜像而非 `pgvector/pgvector:pg16`，容器内没有 vector 扩展文件
- **修复**：确认 `docker-compose.yml` 中镜像为 `pgvector/pgvector:pg16`，重建容器：
  ```bash
  docker compose down    # 不带 -v，保留数据卷
  docker compose up -d
  ```
- **验证**：`docker ps --filter name=inkweaver-postgres --format "{{.Image}}"` 输出 `pgvector/pgvector:pg16`，迁移执行成功

---

## #3 document_chunks 表缺少 embedding 列（synchronize 冲突）

- **日期**：2026-07-31
- **模块**：`apps/server` AI/RAG
- **现象**：调用 `/api/ai/ask` 返回 500，报 `column "embedding" does not exist`；手动 `ALTER TABLE ADD COLUMN` 后列又被删除
- **根因**：
  1. `database.config.ts` 中 `synchronize: nodeEnv !== 'production'`，开发环境为 `true`
  2. `DocumentChunk` entity 未声明 `embedding` 列（pgvector 的 `vector(512)` 类型 TypeORM 不支持维度修饰符）
  3. TypeORM `synchronize` 启动时根据 entity 同步表结构，创建不含 embedding 列的表，并在后续启动中删除手动添加的该列
  4. 迁移脚本中 `CREATE TABLE IF NOT EXISTS` 因表已存在而跳过，embedding 列始终不会被创建
- **修复**：
  1. 将 `database.config.ts` 中 `synchronize` 改为 `false`，所有环境统一走迁移脚本
  2. 停止 NestJS dev 服务后，手动补列：
     ```sql
     ALTER TABLE document_chunks ADD COLUMN embedding vector(512);
     ```
  3. 重启 NestJS
- **验证**：`\d document_chunks` 显示 `embedding | vector(512)` 列，`/api/ai/ask` 正常返回
- **教训**：使用迁移脚本的项目不应同时开启 `synchronize: true`，两者矛盾；pgvector 等自定义类型列只能通过原始 SQL 迁移管理

---

## #4 InkWeaverEditor 编辑标题首字后失焦

- **日期**：2026-08-04
- **模块**：`apps/web`、`apps/h5` DocumentEditPage
- **现象**：在标题输入框敲第一个字符后光标立刻丢失，需重新点击才能继续输入
- **根因**：
  1. 新建文档进入编辑页时 `document.id` 初始为空字符串
  2. 首次输入触发 `handleTitleChange` → `ensureTempId()` 生成 tempId 并写回 `document.id`
  3. `InkWeaverEditor` 的 `key` 绑定在 `document.id` 上，id 变化导致组件卸载重挂载，输入框失焦
- **修复**：
  1. `InkWeaverEditor` 的 `key` 改用路由参数 `id`（来自 `useParams`），稳定不变
  2. tempId 由 `tempIdRef` 稳定持有，不再写回 `document.state.id`
  3. `document.id` 只在 `saveDocument` 转正成功后唯一写回正式 id（此时重挂载符合预期）
- **验证**：新建文档连续输入标题不再失焦；保存后路由跳转到正式 id，编辑器内容连续不丢
- **教训**：React 受控组件的 `key` 应绑定在路由或外生稳定标识上，避免内部 state 变化触发重挂载

---

## #5 DocumentEditPage 定时器与节流器内存泄漏

- **日期**：2026-08-04
- **模块**：`apps/web`、`apps/h5` DocumentEditPage，`packages/shared` pushThrottle
- **现象**：编辑页卸载后，`contentDebounceRef`、`metaProjectionRef` 的 `setTimeout` 与 `pushPendingThrottleRef` 的节流 timer 仍可能触发，闭包引用旧 state 写本地 DB / 调接口
- **根因**：
  1. 组件缺少卸载 cleanup，定时器未 `clearTimeout`
  2. `createPushThrottle` 未暴露 `cancel` 方法，调用方无法清理节流 timer
- **修复**：
  1. `packages/shared/src/utils/pushThrottle.ts` 新增 `PushThrottle` 类型与 `cancel()` 方法，清空 timer 与入队参数
  2. DocumentEditPage 新增 `useEffect(() => () => { ... }, [])` 卸载清理：清空两个 `setTimeout` ref，调用 `pushPendingThrottleRef.current?.cancel()` 并置 null
  3. temp 文档的 `yDoc.on('update', handleUpdate)` 监听用 `tempUpdateDisposers.current` 登记 disposer，卸载或 id 变化时反注册
- **验证**：编辑后立即切走路由，控制台不再出现卸载后的 `localDB.saveUpdate` / `documentService.updateDocument` 调用；`pushThrottle.test.ts` 通过
- **教训**：所有 `setTimeout` / 自定义节流器都必须有配对的清理出口；自定义节流工具应内置 `cancel`

---

## #6 isApplyingRemoteRef 同步重置失效与 updater 内 side effect

- **日期**：2026-08-04
- **模块**：`apps/web`、`apps/h5` DocumentEditPage
- **现象**：
  1. 远端 update 触发 `setDocument` 后，`isApplyingRemoteRef` 立即被重置为 false，导致同帧内的 `handleContentChange` 误判为本地输入，回写 Yjs 造成循环
  2. `handleTitleChange` / `handleContentChange` 在 `setDocument(prev => {...})` updater 内部执行 `localDB.saveDoc`、`scheduleMetadataProjection` 等 side effect，StrictMode 双调用下重复执行
- **根因**：
  1. `isApplyingRemoteRef.current = false` 紧跟 `setDocument` 同步执行，但 `setDocument` 触发的 re-render 与 `handleContentChange` 在同一事件循环，ref 已被重置
  2. React updater 必须是纯函数，StrictMode 下会双调用以检测副作用，side effect 写在 updater 内必然重复
- **修复**：
  1. `isApplyingRemoteRef.current = false` 改为 `setTimeout(() => { isApplyingRemoteRef.current = false; }, 0)`，延迟到下一事件循环，确保 re-render 期间 ref 仍为 true
  2. 新增 `documentRef = useRef(document); documentRef.current = document;` 同步指向最新 state
  3. `handleTitleChange` / `handleContentChange` / `handleMapUpdate` 改为：从 `documentRef.current` 读最新 state，等值短路，side effect（`localDB.saveDoc`、`scheduleMetadataProjection`）在 `setDocument` 外部执行，updater 仅返回新 state
  4. 统一 `handleContentChange` 的 if/else 分支逻辑，临时文档与正式文档都走"读 ref → 短路 → 计算 updated → 写 ref → side effect → setDocument"
- **验证**：远端推送内容不再被本地回写循环；StrictMode 下 `localDB.saveDoc` / `documentService.updateDocument` 每次输入只触发一次
- **教训**：`setState` updater 必须保持纯函数；ref 状态的复位时机要考虑同帧内的下游闭包回调，必要时用 `setTimeout(0)` 推迟

---

## #7 协同房间泄漏 + pull 慢速成功误判超时 + h5 缺失 leaveDocRoom

- **日期**：2026-08-05
- **模块**：`apps/web`、`apps/h5` DocumentEditPage / syncService，新增 `packages/sync-client`
- **现象**：
  1.切文档/卸载时 cleanup 调用 `leaveDocRoom(id)`，但 `joinDocRoom(id)` 仍在 `await connectSocket()` 中，`docRooms` 未包含该 id，`leaveDocRoom` 直接 return；后续 `joinDocRoom` 解析后仍 `emit('join-doc')`，房间被加入但永不离开，服务端持续向已离开的客户端推送 update
  2.`pull` 的 `while` 因 `hasMoreData === false` 成功退出后，仍执行 `if (Date.now() - startTime >= maxExecutionTime) throw`，丢弃已拉取的全部结果
  3.（h5 隐藏 P0）h5 的 `syncService.ts` 从未导出 `leaveDocRoom`，但 DocumentEditPage import 并调用它，运行时抛 `TypeError`，h5 切文档/卸载时房间永不离开
- **根因**：
  1. `joinDocRoom` 的 `await connectSocket()` 与 `docRooms.add(docId)` 之间存在时间窗，cleanup 在此期间调用 `leaveDocRoom` 时检查 `docRooms.has` 失败而 return；调用方分四次组装 join/leave/onUpdate/offUpdate 的成对生命周期，竞态由调用方承担
  2. `pull` 的超时检查未区分"还有更多数据"与"已成功完成"，无条件抛错
  3. web 与 h5 的 syncService 是两份复制代码，h5 漏掉 `leaveDocRoom` 实现，typecheck 未跑过未发现
- **修复**：
  1. 抽取 `@inkweaver/sync-client` 包，统一 syncService 装配层（localDB / authService / documentApi / socketUrl / clientId 依赖注入）
  2. 用 `subscribeDocRoom(docId, onUpdate): Unsubscribe` 引用计数模型封装"加入房间 + 注册监听 + 离开房间 + 反注册"：
     - joinState 三态机（idle / pending / joined）：`await connectSocket` 期间被取消则 state 回 idle，`joinDocRoomInternal` 自检 state !== 'pending' 时不 emit join-doc
     - 引用计数归零（最后一个订阅者离开）才 emit leave-doc
     - 重连时 `socket.on('connect')` 仅 rejoin 状态为 joined 的房间
  3. `pull` 的超时检查改为 `if (hasMoreData && Date.now() - startTime >= maxExecutionTime)`，仅在未完成时抛超时
  4. web/h5 的 DocumentEditPage 改用 `subscribeDocRoom`，移除 join/leave/onUpdate/offUpdate 直接调用
- **验证**：`pnpm --filter @inkweaver/sync-client build` 通过；`@inkweaver/sync-client` / `@inkweaver/web` / `@inkweaver/h5` 三个 typecheck 全通过；`@inkweaver/sync-engine` / `@inkweaver/shared` 测试无回归
- **教训**：成对的生命周期（join/leave、register/unregister）应封装为订阅模型，由引用计数驱动，避免调用方组装竞态；跨端复制代码需以包形式复用，否则极易漂移

---

## #8 AuthGuard 不校验 JWT 类型（refresh token 可当 access token 使用）

- **日期**：2026-08-10
- **模块**：`apps/server/src/modules/auth/guard/auth.guard.ts`
- **现象**：
  `AuthGuard.canActivate` 只调用 `jwtService.verifyAsync(token)` 验证签名与过期时间，未检查 `payload.type` 字段。`AuthService.generateRefreshToken` 签发的 refresh token（`type: 'refresh'`，有效期 30 天）可直接作为 access token 使用，访问所有受 `AuthGuard` 保护的 REST 接口。
- **根因**：
  JWT payload 中已包含 `type: 'access' | 'refresh'` 字段用于区分令牌用途，但 `AuthGuard` 仅验证 JWT 合法性，未执行类型校验。
- **修复**：
  在 `verifyAsync` 成功后增加 `if (payload.type !== 'access')` 检查，对非 access token 抛出 `UnauthorizedException`。
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：JWT 令牌用途隔离必须在守卫层强制校验，不能依赖客户端正确使用令牌

---

## #9 全局错误过滤器向外泄漏堆栈

- **日期**：2026-08-10
- **模块**：`apps/server/src/main.ts`
- **现象**：
  全局错误过滤器对非 `HttpException` 的异常，响应体中直接包含 `exception.stack`。任何未捕获异常会把 Node.js 调用栈、文件路径、内部模块结构暴露给客户端；`exception.message` 也可能包含敏感的数据库错误细节。
- **根因**：
  过滤器实现未区分开发/生产环境，一律把完整堆栈作为响应体返回。
- **修复**：
  1. 通过 `process.env.NODE_ENV !== 'production'` 判断当前是否为开发环境
  2. 生产环境响应体仅返回通用 `Internal server error`，不包含 `stack` 和原始 `message`
  3. 开发环境保留 `stack` 字段供调试，但仍通过 `console.error` 在服务端记录完整堆栈
  4. `HttpException` 分支不受影响（状态码与 message 是业务预期的）
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：全局错误响应必须默认"最小化输出"，敏感信息只在服务端日志中保留；堆栈泄漏等于把应用内部结构完整暴露给攻击者

---

## #10 JWT secret 回退到硬编码值（非生产环境弱密钥）

- **日期**：2026-08-10
- **模块**：`apps/server/src/config/jwt.config.ts`
- **现象**：
  `getJwtModuleOptions` 在 `JWT_SECRET` 缺失时回退到硬编码 `'fallback-secret-key'`。`assertStrongSecretsInProduction` 仅在 `NODE_ENV === 'production'` 时抛错，开发/测试/预发布环境只 warn。若预发布环境被外网访问，攻击者可用公开的 fallback secret 伪造任意用户的 JWT（HS256 签名校验通过），获得全部受保护接口的访问权。
- **根因**：
  为开发便利提供了硬编码回退值，但没有意识到 `assertStrongSecretsInProduction` 的保护仅限 production 环境，导致 staging/pre-prod 等非生产环境处于无保护状态。
- **修复**：
  移除 `'fallback-secret-key'` 回退值，改为在 `JWT_SECRET` 缺失时直接 `throw new Error(...)`。JwtModule 注册时即抛错，早于 `assertStrongSecretsInProduction` 调用，任何环境都无法绕过。
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过；3 个单元测试通过（含新增的"JWT_SECRET 未配置时抛错"用例）
- **教训**：安全敏感配置（密钥、密码等）禁止硬编码回退；"开发便利"不能以安全为代价；启动期校验应在密钥被使用之前执行，而非之后

---

## #11 Sync push TOCTOU 竞态条件（并发更新冲突检测失效）

- **日期**：2026-08-12
- **模块**：`apps/server/src/modules/sync/sync.controller.ts`、`sync.gateway.ts`
- **现象**：
  客户端通过 REST `POST /api/sync/push` 或 WebSocket `update` 事件上行 Yjs updates 时，服务端先查询 `latestUpdateId`，再检查 `baseUpdateId` 是否落后，最后保存 updates。两个并发请求可能同时通过冲突检测，导致 Yjs CRDT 的并发更新被线性化但未正确检测到冲突。
- **根因**：
  `push()` 和 `handleUpdate()` 的关键路径 "查询最新 updateId → 冲突检测 → 保存 updates" 之间没有原子性保证。在 `findOne` 和 `save` 之间，另一个请求可以插入新的 update，导致前一个请求的冲突检测基于过期的快照。
- **修复**：
  1. 注入 `DataSource`（从 `typeorm` 导入，非 `@nestjs/typeorm`）
  2. 使用 `this.dataSource.transaction(async manager => { ... })` 包裹关键区域
  3. 查询最新 updateId 时使用 `lock: { mode: 'pessimistic_write' }` 实现 `SELECT ... FOR UPDATE` 悲观锁
  4. 网关冲突检测保持原有 WebSocket 协议：冲突时返回 `{ conflict: true, serverUpdateId }`，在事务外通过 `client.emit('conflict', ...)` 通知客户端
  5. 广播和副作用（`scheduleRecalculateByDocId` 等）放在事务外执行，避免长事务
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过；单元测试 mock DataSource 事务逻辑
- **深度笔记**：[docs/技术笔记.md#笔记-2：TOCTOU-竞态与数据库锁机制](file:///d:/Codex_Workspaces/software-development/projects/SyncBox-AI/docs/技术笔记.md#L227-L484) 包含问题本质、时序图、方案对比、代码实现、性能分析
- **教训**：
  1. 涉及"读-判-写"模式的业务逻辑必须用事务 + 悲观锁保护，特别是协作编辑场景下的高频并发更新
  2. 副作用（广播、缓存更新）应在事务提交后执行，避免长事务阻塞
  3. Yjs CRDT 解决了数据合并问题，但业务层的冲突检测（baseUpdateId）仍需要数据库锁保证原子性

---

## #12 Session 时间列类型不一致（timestamp vs timestamptz）

- **日期**：2026-08-12
- **模块**：`apps/server/src/modules/auth/entity/session.entity.ts`、`apps/server/src/migrations/1754000000000-SessionsTimestampToTimestamptz.ts`
- **现象**：
  `sessions` 表的 `expiresAt`、`lastActivityAt`、`createdAt`、`updatedAt` 列为 `TIMESTAMP`（不带时区），而 `password_reset_tokens`、`documents` 等表对应列使用 `TIMESTAMP WITH TIME ZONE`。`validateRefreshToken` 用 `expiresAt: MoreThan(new Date())` 比较时，PostgreSQL 在比较 `TIMESTAMP WITHOUT TIME ZONE` 与带时区的参数时，会按 session 的 `timezone` 设置解释列值，导致跨时区服务器出现会话提前过期或延迟过期。
- **根因**：
  实体声明 `@Column({ type: 'timestamp' })` 映射到 `TIMESTAMP WITHOUT TIME ZONE`；`@CreateDateColumn()` 和 `@UpdateDateColumn()` 默认也使用无时区类型。项目其他表（`password_reset_tokens`、`notifications`、`documents`）已使用 `TIMESTAMP WITH TIME ZONE`，`sessions` 表遗漏了这一规范。
- **修复**：
  1. 实体改为 `type: 'timestamptz'`（PostgreSQL `TIMESTAMP WITH TIME ZONE`）
  2. `@CreateDateColumn({ type: 'timestamptz' })`、`@UpdateDateColumn({ type: 'timestamptz' })` 显式指定类型
  3. 新增迁移 `SessionsTimestampToTimestamptz`：对 4 个时间列执行 `ALTER COLUMN ... TYPE TIMESTAMP WITH TIME ZONE USING ... AT TIME ZONE 'UTC'`
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：时间列类型必须全库统一使用 `TIMESTAMP WITH TIME ZONE`；PostgreSQL 的 `TIMESTAMP` 不带时区，在与时区感知参数比较时依赖服务器时区设置，部署环境切换时可能产生隐蔽的行为差异

---

## #13 CORS 全开（HTTP + WebSocket）

- **日期**：2026-08-12
- **模块**：`apps/server/src/main.ts`、`apps/server/src/modules/sync/sync.gateway.ts`、`apps/server/.env`
- **现象**：
  `main.ts` 使用 `cors: true`（等价于 `Access-Control-Allow-Origin: *`），允许任意站点跨域调用 REST API。`sync.gateway.ts` 的 WebSocket CORS 也使用 `process.env.CORS_ORIGIN?.split(',') ?? true`，未配置时同样全开放。攻击者可从任意恶意站点发起跨域请求，窃取 JWT token 保护的数据。
- **根因**：
  初始开发阶段为方便调试直接设置 `cors: true`，后续未在生产部署前改为白名单。虽然 `app.config.ts` 已定义 `corsOrigin` 字段，但 `main.ts` 中从未使用该配置。WebSocket 网关的 `?? true` 兜底也存在同样问题。
- **修复**：
  1. `main.ts`：读取 `process.env.CORS_ORIGIN`，支持逗号分隔的多 origin 白名单；生产环境未配置时仅允许 `APP_PUBLIC_URL` 并输出警告日志；开发环境兜底保持 `true` 方便调试
  2. `sync.gateway.ts`：同步改为相同的安全兜底逻辑，生产环境未配置时仅允许 `APP_PUBLIC_URL`（空数组则禁用 CORS）
  3. `.env` 新增 `CORS_ORIGIN=http://localhost:3003`
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：CORS 全开（`*`）在开发阶段方便调试，但必须在生产环境部署前改为显式白名单；HTTP 和 WebSocket 两条通道的 CORS 配置必须保持一致，避免安全策略出现双通道不一致

---

## #14 请求体大小限制 100MB → 5MB

- **日期**：2026-08-12
- **模块**：`apps/server/src/main.ts`
- **现象**：
  `bodyParser.json({ limit: '100mb' })` 允许单个 HTTP 请求携带最高 100MB 的 JSON body。Node.js 默认堆内存约 1.5GB，几个并发的大请求即可导致 OOM 崩溃。
- **根因**：
  开发阶段为避免上传大文件时 body limit 不够，设置了 100MB。但文件上传走 `multipart/form-data`，由 `FileInterceptor`（已有 5MB limit）单独控制，JSON body 不需要这么大。
- **修复**：
  将 JSON 和 URL-encoded body limit 都改为 `5mb`，并添加注释说明文件上传不受此限制。选择 5MB 的依据：
  - Sync push 的 DTO 已有严格校验（单条 update 最大 512KB、最多 50 条），实际 payload 远小于 5MB
  - 文件上传走 `multipart/form-data`，由 `FileInterceptor` 独立控制
  - 与现有文件上传的 5MB limit 保持一致
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：JSON body limit 应与实际业务需求匹配，不能因为有大文件上传就把 JSON body limit 也设很大；`FileInterceptor` 和 `bodyParser` 是两个独立的限制机制，互不影响

---

## #15 folderId / parentId 归属未校验（越权访问）

- **日期**：2026-08-12
- **模块**：`apps/server/src/modules/documents/documents.service.ts`、`apps/server/src/modules/documents/folders.service.ts`
- **现象**：
  `updateDocument` 允许用户修改 `folderId`，但未校验目标文件夹是否属于当前用户。攻击者可将文档挂载到其他用户的文件夹下，破坏数据隔离。`updateFolder` 修改 `parentId` 同样存在此问题——攻击者可将文件夹设为其他用户的子文件夹。
- **根因**：
  `folderId` 被视为普通数据字段而非权限边界，修改时仅做存在性检查（`getDocument` 已校验文档归属），但未校验关联资源（文件夹/父文件夹）的归属。
- **修复**：
  1. `documents.service.ts`：新增 `assertFolderOwnership(userId, folderId)` 私有方法，查询 `foldersRepository.findOne({ where: { id: folderId, userId } })`，不存在则抛 `ForbiddenException`
  2. `createDocument`：创建文档时若指定 `folderId`，先调用 `assertFolderOwnership` 校验
  3. `updateDocument`：修改 `folderId` 时（`!== null`，即设为具体文件夹时）先校验；设为 `null`（移出文件夹）无需校验
  4. `folders.service.ts`：`updateFolder` 修改 `parentId` 时（`!== null`），通过 `foldersRepository.exist({ where: { id, userId } })` 校验父文件夹归属
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：涉及资源关联的字段（`folderId`、`parentId` 等）必须校验归属权；设为 `null`（解除关联）时无需校验；Service 层的校验方法应复用 Repository 查询，避免循环依赖

---

## #16 认证接口缺少限流（暴力破解 / 邮件轰炸）

- **日期**：2026-08-12
- **模块**：`apps/server/src/app.module.ts`、`apps/server/src/modules/users/users.controller.ts`、`apps/server/src/modules/auth/auth-password.controller.ts`
- **现象**：
  `POST /api/users/login`、`POST /api/users/register`、`POST /api/auth/forgot-password`、`POST /api/auth/reset-password` 四个接口无任何请求频率限制。攻击者可无限次尝试密码（暴力破解），或对任意邮箱发送重置密码邮件（邮件轰炸/枚举已注册邮箱）。
- **根因**：
  开发阶段未考虑接入限流中间件，`@nestjs/throttler` 虽已在 `package.json` 中声明依赖，但未在任何模块中注册和使用。
- **修复**：
  1. `app.module.ts`：注册 `ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])` 作为全局默认配置（每分钟 100 次，足够正常使用）
  2. `users.controller.ts`：
     - 添加 `@UseGuards(ThrottlerGuard)` 启用限流守卫
     - `login`：`@Throttle({ default: { ttl: 60000, limit: 10 } })` — 每分钟最多登录 10 次（防暴力破解）
  3. `auth-password.controller.ts`：
     - 添加 `@UseGuards(ThrottlerGuard)` 启用限流守卫
     - `forgot-password`：`@Throttle({ default: { ttl: 300000, limit: 3 } })` — 每 5 分钟最多发送 3 封重置邮件
     - `reset-password`：`@Throttle({ default: { ttl: 60000, limit: 5 } })` — 每分钟最多重置 5 次
  4. `register` 接口不加限流——反垃圾注册应靠验证码/邮箱验证，IP 限流无法防御代理池攻击且会误伤共用网络（公司/学校/家庭 Wi-Fi）的正常用户
  5. 所有限流基于 IP 地址（NestJS Throttler 默认行为），即同一 IP 的请求共享计数
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 认证相关接口中，登录/密码重置必须限流，注册不应靠 IP 限流
  - `forgot-password` 应使用更长的 TTL（5 分钟）和更低的 limit，因为发邮件成本高且危害大
  - NestJS Throttler 基于 IP 限流，如需按用户/邮箱维度限流需自定义 Tracker
  - 反垃圾注册的正确方式：验证码（CAPTCHA）+ 邮箱验证 + 设备指纹，而非简单 IP 限流

---

## #17 用户头像上传缺少魔数校验

- **日期**：2026-08-13
- **模块**：`apps/server/src/modules/users/users.service.ts`、`apps/server/src/common/image-signature.ts`、`apps/server/src/modules/storage/storage-asset.service.ts`
- **现象**：
  `updateAvatar` 接口仅校验客户端声明的 `mimetype` 和文件大小，不校验文件头魔数。攻击者可将 HTML/JS 等恶意文件的 `Content-Type` 改为 `image/png` 后上传，绕过 MIME 类型检查。相比之下 `StorageAssetService.saveUserAsset` 已有魔数校验。
- **根因**：
  头像上传的安全校验逻辑不完整，仅信任客户端声明的 MIME 类型，未验证文件内容是否与声明类型一致。
- **修复**：
  1. 将 `matchesImageSignature` 函数从 `storage-asset.service.ts` 提取到 `common/image-signature.ts` 作为共享工具
  2. 在 `updateAvatar` 中添加第三步校验：`matchesImageSignature(file.mimetype, file.buffer)`
  3. 支持的签名：JPEG (`FF D8 FF`)、PNG (`89 50 4E 47 0D 0A 1A 0A`)、WebP (`RIFF....WEBP`)
  4. `StorageAssetService` 改为从共享位置导入，保持两处校验逻辑一致
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 文件上传必须同时校验 MIME 类型和魔数，二者缺一不可
  - 校验逻辑应提取为共享工具，避免不同服务间出现校验不一致
  - 对于非图片类文件上传场景（如文档、代码），更应严格校验魔数或使用专用解析器

---

## #18 chunkPlainText 参数校验缺失导致拒绝服务

- **日期**：2026-08-13
- **模块**：`apps/server/src/modules/ai/chunking.ts`
- **现象**：
  `chunkPlainText` 函数使用 `step = Math.max(1, chunkSize - overlap)` 计算步进。当调用方传入 `overlap >= chunkSize` 时，step 退化为 1，导致每个字符生成一个 chunk。对数千字文档会产生数千个 chunk，每个 chunk 触发一次嵌入服务调用，瞬间打爆嵌入服务和向量数据库。
- **根因**：
  缺少参数校验，`Math.max(1, ...)` 的兜底逻辑反而掩盖了非法参数问题，将其转化为性能灾难。
- **修复**：
  1. 在函数入口添加 `chunkSize <= 0` 校验，抛出错误
  2. 添加 `overlap < 0 || overlap >= chunkSize` 校验，抛出错误并附带当前参数值便于排查
  3. 移除 `Math.max(1, ...)` 兜底，改为直接使用 `chunkSize - overlap`
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - `Math.max(1, ...)` 式的兜底保护有时会掩盖上游参数错误，将逻辑问题转化为性能问题
  - 计算密集型操作（如向量化）的入口函数必须严格校验参数，防止被滥用导致资源耗尽

---

## #19 register 邮箱唯一性 TOCTOU

- **日期**：2026-08-13
- **模块**：`apps/server/src/modules/users/users.service.ts`
- **现象**：
  `register` 方法先通过 `findByEmail` 检查邮箱是否存在，再调用 `create` 插入用户记录。当两个并发请求同时注册同一邮箱时，两个请求都能通过前置检查，第一个 INSERT 成功，第二个 INSERT 触发数据库唯一约束冲突（PostgreSQL 错误码 23505），但该错误未被捕获转换为 `ConflictException`，直接冒泡为 500 Internal Server Error。
- **根因**：
  经典的 TOCTOU（Time-of-check to time-of-use）竞态条件。应用层检查和数据库写入之间存在时间窗口，缺少对数据库唯一约束冲突的异常捕获。
- **修复**：
  1. 在 `register` 方法中用 `try-catch` 包裹 `create` 调用
  2. 捕获 `QueryFailedError`，检查 `driverError.code === '23505'`（PostgreSQL 唯一约束冲突）
  3. 将唯一约束冲突转换为 `ConflictException('邮箱已存在')`，保持与前置检查一致的 409 响应
  4. 保留前置 `findByEmail` 作为快速路径优化（避免不必要的 INSERT 和回滚）
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 数据库唯一约束是并发场景下的最后一道防线，必须在应用层捕获并转换为友好的业务异常
  - 前置检查 + 唯一约束捕获是处理唯一性校验的标准模式，二者互补而非替代
  - 所有可能触发数据库约束冲突的写操作都应考虑 TOCTOU 场景

---

## #20 WebSocket 房间成员权限无回收

- **日期**：2026-08-13
- **模块**：`apps/server/src/modules/sync/sync.gateway.ts`、`apps/server/src/modules/documents/documents.service.ts`
- **现象**：
  WebSocket 客户端通过 `join-doc` 加入文档房间时，`handleJoinDoc` 调用 `assertDocumentActive(docId, userId)` 校验权限。但加入后，若文档被删除（软删/硬删），socket 仍留在 `doc-${docId}` 房间内，继续接收 `handleUpdate` 广播的 update 数据。
- **根因**：
  房间成员管理缺少反向回收机制。当前只有"加入"时的权限校验，没有"权限丧失"时的主动踢出。
- **修复**：
  1. 在 `SyncGateway` 新增 `evictFromDocRoom(docId)` 方法，遍历房间内所有 socket 并调用 `leave()` 移出房间
  2. 在 `SyncModule` 导出 `SyncGateway`，`DocumentsModule` 通过 `forwardRef` 导入 `SyncModule`，解决循环依赖
  3. `DocumentsService` 注入 `SyncGateway`，在以下删除流程中调用踢出：
     - `softDeleteDocument`（软删单个文档）
     - `softDeleteDocumentsInFolder`（批量删除文件夹文档）
     - `hardDeleteDocument`（永久删除，被 `permanentlyDeleteDocument` / `emptyTrash` / `purgeExpiredTrash` 调用）
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - WebSocket 房间的生命周期管理需要"加入"和"踢出"两个对称操作，不能只加不减
  - 文档权限变更（删除、私有化）时，必须同步清理 WebSocket 房间成员
  - NestJS 循环依赖可通过 `forwardRef` 解决，适用于跨模块双向调用的场景

---

## #21 Yjs.Doc 实例未销毁导致内存泄漏

- **日期**：2026-08-14
- **模块**：`apps/server/src/modules/sync/snapshot.service.ts`、`document-projection.service.ts`、`documents.service.ts`
- **现象**：
  `generateSnapshot`、`projectDocument`、`generateInitialSnapshotAndUpdate` 三个方法中均使用 `new Y.Doc()` 创建临时文档实例，但方法结束时未调用 `yDoc.destroy()`。Yjs Doc 实例持有共享数组、映射、撤销栈等内部状态，在长生命周期 Node 进程中频繁调用会导致内存持续堆积。
- **根因**：
  Yjs 文档的 `destroy()` 方法会释放内部状态的所有引用（共享结构、事件监听器、GC 根），但代码中遗漏了这一清理步骤。
- **修复**：
  三处 `new Y.Doc()` 均添加 `try/finally` 包裹，确保 `yDoc.destroy()` 在所有执行路径（正常返回、提前 return、异常抛出）中都会被调用。
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 所有持有内部状态的临时对象（Yjs Doc、数据库连接、文件句柄）都必须配对释放
  - `try/finally` 是确保资源释放的标准模式，即使在提前 return 的场景下也能保证清理

---

## #22 快照清理方法是死代码

- **日期**：2026-08-14
- **模块**：`apps/server/src/modules/sync/snapshot.service.ts`
- **现象**：
  `cleanupOldSnapshots(docId, keepCount=3)` 方法遍历旧快照并尝试保留 3 条。但 `DocSnapshot` 实体有 `UNIQUE(docId)` 约束，`generateSnapshot` 使用 `upsert({ conflictPaths: ['docId'] })` 永远只保留 1 条。因此 `snapshots.length > keepCount` 永远为 false，函数体从不执行。
- **根因**：
  快照策略在演进中从"保留历史版本"变为"每文档只保留最新快照"，但旧的清理方法未同步删除，形成死代码。
- **修复**：
  1. 删除 `cleanupOldSnapshots` 方法
  2. 移除 3 处调用（`scheduleSnapshot`、`runPeriodicSnapshotGeneration`、`triggerSnapshotGeneration`）
  3. 明确快照策略：由唯一索引 + upsert 天然保证每文档只保留最新快照
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 数据库唯一约束决定了代码逻辑的实际执行路径；`UNIQUE(docId)` 下不可能存在多条快照
  - 策略变更时应同步清理旧代码，避免死代码误导维护者

---

## #23 文件夹循环引用检查缺失

- **日期**：2026-08-14
- **模块**：`apps/server/src/modules/documents/folders.service.ts`
- **现象**：
  `updateFolder` 直接赋值 `folder.parentId = updateFolderDto.parentId`，不检查目标是否是自身或其后代。攻击者可构造 `A→B→A` 循环引用，导致 `getFolderTree` 无限循环、`deleteFolderWithContent` 栈溢出。
- **根因**：
  文件夹树结构缺少变更时的完整性校验，`parentId` 被视为普通数据字段而非树结构的关键约束。
- **修复**：
  1. 新增 `isDescendant(ancestorId, targetId, userId)` 私有方法，使用 BFS 逐层遍历子树检查 targetId 是否在后代中
  2. `updateFolder` 在设置 `parentId` 前增加两道防线：
     - `newParentId === folderId` 拒绝自引用
     - `isDescendant(folderId, newParentId)` 拒绝将文件夹移动到其后代下
  3. 两道防线均抛出 `BadRequestException`，提示具体原因
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 树结构的 parentId 变更必须校验无环，防止破坏树的完整性
  - 循环引用防护应在写操作入口处强制校验，而非依赖下游方法的防御处理

---

## #24 深嵌套文件夹删除改为 BFS 迭代 + 预检查上限

- **日期**：2026-08-17
- **模块**：`apps/server/src/modules/documents/folders.service.ts`
- **现象**：
  `deleteFolderWithContent` 使用 DFS 递归遍历子文件夹树，每层嵌套压入一个 JS 栈帧。Node.js 默认栈大小约 1.4MB，每帧约 250 字节，5600+ 层嵌套即栈溢出。此外无上限预检查，删除到第 501 个才报错，前 500 个已删除，数据库不一致。
- **根因**：
  递归深度不受限制，且"先执行后报错"的模式导致部分成功、部分失败的不一致状态。
- **修复**：
  1. 将 DFS 递归改为 BFS 迭代，消除调用栈深度限制
  2. 添加 `MAX_DELETE_FOLDERS = 500` 预检查上限，在收集阶段（纯读）完成后即判断是否超限，超限直接拒绝、零数据库变更
  3. 使用 `visited` Set 双重防环（出队时检查 + 入队时检查）
  4. 两阶段设计：收集阶段（纯读 BFS）→ 执行阶段（逆序删除，子先父后）
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **深度笔记**：[docs/技术笔记.md#笔记-5：深嵌套树遍历——迭代-预检查上限模式](file:///d:/Codex_Workspaces/software-development/projects/SyncBox-AI/docs/技术笔记.md#L735)
- **教训**：
  - 递归的核心风险不在"慢"，而在"栈溢出"——迭代的优势是可控性
  - "先读后写、先检查后执行"的两阶段设计保证操作原子性
  - visited 双重检查（出队+入队）是防环的标准模式

---

## #25 列表分页参数边界校验

- **日期**：2026-08-13
- **模块**：`apps/server/src/modules/documents/documents.service.ts`
- **现象**：
  `@Query("page") page: number = 1` 实际是字符串，`Number(page)` 不校验范围。客户端可传 `pageSize=99999999` 或 `page=-1`，造成大 skip/take 引发 PostgreSQL 慢查询或内存峰值。
- **根因**：
  分页参数缺少边界校验，信任了客户端传入值。
- **修复**（方案 B：Service 层 clamp）：
  在 `getDocuments`、`searchDocuments`、`getTrashDocuments` 三个方法的开头统一添加：
  ```typescript
  page = Math.max(1, Math.floor(page));
  pageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  ```
  无论参数来自 Controller query、内部调度还是测试调用，都统一受控。
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 分页参数应在 Service 层做 clamp，而非依赖 DTO/Pipe——所有调用路径统一受控
  - `Math.max(1, ...)` 处理负数/零，`Math.min(100, ...)` 处理超大值，配合 `Math.floor` 确保整数

---

## #26 Token 双重哈希验证模式（Token 快筛）

- **日期**：2026-08-14
- **模块**：`apps/server/src/modules/auth/session.service.ts`、`session.entity.ts`、`migrations/1754200000000-SessionsAddRefreshTokenLookup.ts`
- **现象**：
  `validateRefreshToken` 先查询用户所有活跃会话（可能上百条），再逐条 `bcrypt.compare`。bcrypt 故意设计得慢（单次 ~100ms），100 个会话即需 10 秒。攻击者可通过创建大量会话拖垮 Token 验证接口。
- **根因**：
  bcrypt 哈希用于安全校验但速度慢，没有快速定位目标会话的索引机制，导致全量扫描。
- **修复**：
  1. `session.entity.ts` 新增 `refreshTokenLookup` 字段（SHA-256 十六进制哈希）
  2. `createSession` 同时写入 bcrypt 哈希（安全校验）和 SHA-256 哈希（索引定位）
  3. `validateRefreshToken` 先用 SHA-256 哈希命中索引行（O(1)），再对候选行做单次 `bcrypt.compare`
  4. 历史数据（lookup 为空）回退全量扫描，首次命中后自动回填
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **深度笔记**：[docs/技术笔记.md#笔记-4：Token-双重哈希验证模式](file:///d:/Codex_Workspaces/software-development/projects/SyncBox-AI/docs/技术笔记.md#L651)
- **教训**：
  - 「快筛（SHA-256）+ 慢验（bcrypt）」的双重哈希模式将 O(N) 次 bcrypt 降为 1 次
  - 快筛用确定性哈希（相同输入 = 相同输出）做索引定位，慢验用加盐哈希做安全校验
  - 历史数据兼容：nullable 列 + 自动回填，确保平滑迁移

---

## #27 deleteFolderOnly 添加 BFS 预检查 + 子树提升保障

- **日期**：2026-08-17
- **模块**：`apps/server/src/modules/documents/folders.service.ts`
- **现象**：
  `deleteFolderOnly` 仅将直接子文件夹的 `parentId` 置 null，未校验后代总数。恶意构造深嵌套文件夹（如 500+ 层）会在删除时产生大量数据库查询，拖垮服务。此外，如果保存直接子文件夹 parentId 和删除文件夹之间发生并发覆盖，可能导致 parentId 链指向已删除的文件夹。
- **根因**：
  删除操作缺少预检查机制，无法在执行前判断操作规模和风险。树结构的维护依赖于"先保存后删除"的顺序保障，但没有显式的深度限制。
- **修复**：
  1. 添加 BFS 预检查：收集所有后代文件夹 ID（含自身），超过 `MAX_DELETE_FOLDERS`(500) 上限则拒绝操作
  2. 使用 `visited` Set 双重防环（出队时 + 入队时），防止循环引用导致的死循环
  3. 提升直接子文件夹为根节点（`parentId = null`），保持孙子及更深后代的子树结构不变
  4. 保存子文件夹后再删除目标文件夹，确保 parentId 链不会指向已删除的文件夹
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 删除操作应先做规模预检查，再执行写操作——"先读后写"的两阶段设计
  - 树结构的 parentId 链维护需要显式的保存顺序保障（先保存新 parentId，再删除旧 parentId）
  - BFS 遍历天然支持深度限制，适合删除前的预检查场景

---

## #28 文档标题/正文/标签添加长度校验

- **日期**：2026-08-17
- **模块**：`apps/server/src/modules/documents/dto/create-document.dto.ts`、`update-document.dto.ts`
- **现象**：
  `CreateDocumentDto` 和 `UpdateDocumentDto` 的 `title`、`content`、`tags` 字段仅使用 `@IsString` 校验，无最大长度限制。恶意客户端可提交数 MB 文本，写入 PG `text` 列后触发 AI 索引服务的切块（chunking），导致向量嵌入（embedding）计算量爆炸。
- **根因**：
  输入校验仅覆盖类型（`@IsString`），未覆盖长度。长文本通过了 DTO 校验层，直接进入 Service 层的 `projectSearchableContent` → `documentIndexService.scheduleReindex` → `chunkPlainText`，造成级联资源消耗。
- **修复**：
  1. `title`：添加 `@MinLength(1)`（禁止空标题）+ `@MaxLength(200)`（合理标题长度）
  2. `content`：添加 `@MaxLength(1_000_000)`（约 1MB 文本，覆盖绝大多数业务场景）
  3. `tags`：单个 tag 添加 `@MaxLength(50, { each: true })`
  4. 两个 DTO（Create/Update）同步添加，保持校验规则一致
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 输入校验应在 DTO 层完成，利用 `class-validator` 的装饰器链实现声明式校验
  - `@MaxLength` 限制在字符数而非字节数，对 ASCII 文本 100 万字符约等于 1MB
  - 数组字段的单元素长度限制使用 `{ each: true }` 选项
  - Create 和 Update 两个 DTO 应保持一致的校验规则，避免绕过

---

## #29 folderId / parentId 列类型不一致（varchar vs uuid）

- **日期**：2026-08-17
- **模块**：`apps/server/src/migrations/1730000000000-InitialSchema.ts`、`1755000000000-ColumnTypeFolderParentToUuid.ts`、`document.entity.ts`、`folder.entity.ts`
- **现象**：
  `folders.id` 是 `uuid`，但 `folders.parentId` 和 `documents.folderId` 建表时被定义为 `character varying`。同库中 `documents.deletedFromFolderId` 已经是 `uuid`，`sync_update.docId` 和 `doc_snapshot.docId` 也是 `character varying`。这种不一致导致：
  1. 无法在外键关联列上建立真正的 FK 约束（类型必须完全匹配）
  2. JOIN 查询时需要显式 cast（如 `ds."docId"::uuid`），无法利用索引
  3. 同一语义的 ID 列在不同表中使用不同类型，维护成本高
- **根因**：
  初始 schema 设计时未统一 ID 列类型规范，部分关联列使用了 `character varying` 而非与主表一致的 `uuid`。
- **修复**：
  1. 新增迁移 `ColumnTypeFolderParentToUuid`：
     - `folders.parentId`：`ALTER COLUMN ... TYPE uuid USING "parentId"::uuid`
     - `documents.folderId`：`ALTER COLUMN ... TYPE uuid USING "folderId"::uuid`
  2. `document.entity.ts`：`folderId` 列类型从 `varchar` 改为 `uuid`（nullable）
  3. `folder.entity.ts`：`parentId` 列类型从 `varchar` 改为 `uuid`（nullable）
  4. `InitialSchema` 同步更新两列为 `uuid`，保证新部署一致
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - 关联列类型必须与被引用列严格一致（包括 nullable 属性），PostgreSQL 不会自动做隐式类型转换
  - `ALTER COLUMN ... TYPE uuid USING col::uuid` 是原地转换的标准做法，迁移前应确保所有非空值为合法 UUID
  - 同一语义的 ID 列应在全库范围内统一类型规范（本项目约定所有 ID 为 `uuid`）

---

## #30 scheduleReindex 未处理 active 状态的旧任务

- **日期**：2026-08-17
- **模块**：`apps/server/src/modules/ai/document-index.service.ts`
- **现象**：
  `scheduleReindex` 使用固定 `jobId = 'reindex-${docId}'` 做去重。当文档正在索引时（job 处于 `active` 状态），若用户再次编辑文档触发新的 reindex 请求：
  1. 旧代码检测到 existing job 为 `active`，不做移除
  2. 尝试以相同 jobId `add` → BullMQ 抛 `Job already exist`
  3. 错误被 `catch` 静默吞掉，新的 reindex 请求丢失
  4. 向量库停留在旧版本，直到下一次显式触发索引
- **根因**：
  BullMQ 的固定 jobId 去重机制只允许一个 jobId 存在一个任务。对于 `active` 状态的任务，既无法移除（正在执行），也无法添加新任务（ID 冲突）。原代码未覆盖此场景，直接丢弃了更新请求。
- **修复**：
  1. 将 `scheduleReindex` 拆为两步：先清理非活跃旧任务，再尝试以固定 jobId 入队
  2. 捕获到 `Job already exist` 错误时（说明存在 active 任务），调用新增的 `enqueueDelayedReindex` 方法
  3. `enqueueDelayedReindex` 使用独立 jobId（`reindex-${docId}-delayed`）延迟 30s 入队，与 active 任务不冲突
  4. 延迟入队前去重：移除已有的延迟任务再添加，确保多次编辑只保留最新内容
  5. 延迟任务完成后通过 `removeOnComplete` 自动清理
- **验证**：`pnpm --filter @inkweaver/server typecheck` 通过
- **教训**：
  - BullMQ 固定 jobId 去重在 `active` 状态下存在"无法替换"的盲区，需要用延迟任务作为补救措施
  - 延迟任务的 jobId 必须与主任务不同，同时要有去重逻辑防止堆积
  - 30s 延迟是经验值：嵌入 API 调用 + 向量写入通常在数秒内完成，30s 留足安全余量

---

## #31 WebSocket 登出后旧 token 未清理，重连仍携带过期凭证

- **日期**：2026-08-17
- **模块**：`packages/sync-client/src/syncService.ts`
- **现象**：用户登出后，`socket` 连接未断开。若 socket 因网络原因自动重连，会携带旧 token（或无 token）连接网关，导致鉴权失败或旧会话残留。
- **根因**：`logout` 仅清理 localStorage 中的 token，未同步断开 WebSocket 连接和清理房间状态。
- **修复**：新增 `disconnectSocket` 方法，登出时显式调用 `socket.disconnect()`、清理 `docRooms` 映射和连接状态回调。
- **验证**：`pnpm --filter @inkweaver/sync-client build` 通过
- **教训**：登出流程必须同步清理所有会话相关状态（localStorage + 内存中的 socket + 房间订阅），否则会出现"已登出但仍接收广播"的安全隐患。

---

## #32 多 apiClient 实例独立刷新队列导致 token 刷新竞态

- **日期**：2026-08-17
- **模块**：`packages/api/src/client.ts`
- **现象**：`createApiClient` 每次调用创建独立的 `isRefreshing` 和 `refreshQueue` 闭包。`apiClient`（默认实例）与 `rawClient`（内部创建）是不同实例，两者同时收到 401 时各自触发 `refreshAccessToken`，第二个刷新请求会因第一个已使 `refresh_token` 失效而失败。
- **根因**：刷新锁和等待队列是实例级而非模块级的。
- **修复**：将 `isRefreshing` 和 `refreshQueue` 提升为模块级单例（`sharedIsRefreshing` / `sharedRefreshQueue`），所有实例共享同一刷新锁。
- **验证**：`pnpm --filter @inkweaver/api build` 通过
- **教训**：涉及共享认证状态的单例（token 刷新锁等）应使用模块级变量而非闭包，避免多实例状态分裂。

---

## #33 切换文档时 metaProjectionRef 未清理，丢失元数据投影

- **日期**：2026-08-17
- **模块**：`apps/web/src/pages/DocumentEditPage.tsx`
- **现象**：`id` 变化时的 cleanup 仅清理 `contentDebounceRef`，不清理 `metaProjectionRef`。切换到文档 B 并编辑时，`scheduleMetadataProjection('B', ...)` 会 `clearTimeout(metaProjectionRef.current)`，覆盖文档 A 尚未触发的投影定时器。
- **根因**：元数据投影的定时器不区分文档，新文档的投影会无条件 `clearTimeout` 旧文档的定时器。
- **修复**：
  1. 新增 `pendingMetaProjectionRef` 存储待执行的投影数据（含 docId）
  2. 定时器触发时校验 docId 一致性，不一致则丢弃
  3. `id` 切换 cleanup 中 flush 待执行投影（立即调用 `documentService.updateDocument`），而非丢弃
  4. 组件卸载 cleanup 中清空 `pendingMetaProjectionRef`
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：定时器驱动的副作用（如 debounce/projection）在文档切换时必须显式处理，不能简单 clear。应先 flush（执行最后一次）再清理，避免数据丢失。

---

## #34 SearchPage highlightSearchTerm 正则注入 + lastIndex 缺陷

- **日期**：2026-08-17
- **模块**：`apps/web/src/pages/SearchPage.tsx`
- **现象**：`new RegExp(\`(${term})\`, 'gi')` 直接将用户输入拼入正则。若 term 含正则元字符（`(`、`)`、`*` 等），会构造非法正则导致页面崩溃。`regex.test(part)` 配合 `g` flag 会因 `lastIndex` 状态化导致间歇性匹配失败。
- **根因**：用户输入未转义直接拼入正则；带 `g` flag 的 `test` 方法受 `lastIndex` 影响。
- **修复**：
  1. 新增 `escapeRegExp` 函数转义正则特殊字符
  2. `highlightSearchTerm` 使用转义后的 term 构建正则
  3. 用 `part.toLowerCase().includes(term.toLowerCase())` 替代 `regex.test(part)`，彻底避免 `lastIndex` 问题
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：将用户输入拼入正则时必须转义特殊字符；带 `g` flag 的正则对象有状态（`lastIndex`），在循环中使用应谨慎，推荐使用 `String.prototype.includes` 等无状态方法。

---

## #35 SearchPage 搜索请求竞态，结果可能错序

- **日期**：2026-08-17
- **模块**：`apps/web/src/pages/SearchPage.tsx`
- **现象**：快速输入搜索关键词时，多个并发请求后发先至，旧关键词的结果覆盖新关键词的结果，导致结果与输入框不一致。
- **根因**：`handleInputChange` 每次按键都直接触发 `handleSearch`，无防抖、无取消、无请求序号校验。
- **修复**：用 `searchRequestIdRef`（请求序号 ref）跟踪最新请求。`handleSearch` 递增序号，仅当序号匹配时才更新 results、history、searching 等状态。旧请求返回时因序号不匹配被丢弃。
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：并发请求结果错序是前端常见竞态。除防抖外，推荐使用请求序号（ref 自增）确保只有最新请求结果生效，比 `AbortController` 更简单可靠。

---

## #36 NoteListPage 删除/移动失败时用户无反馈

- **日期**：2026-08-17
- **模块**：`apps/web/src/pages/NoteListPage.tsx`
- **现象**：`confirmDelete` 和 `confirmMove` 的 catch 仅 `console.error`，finally 直接关闭 Modal。用户看到 Modal 消失但不知道操作失败。
- **根因**：错误处理缺失，catch 块中没有用户可见的反馈。
- **修复**：catch 中调用 `showAlert` 弹出错误对话框，告知用户操作失败原因和重试建议。
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：涉及数据变更的操作（删除、移动、保存等），catch 块必须提供用户可感知的反馈（Alert、Toast 或内联错误提示），不能只 console.error。

---

## #37 CustomModal showAlert 重叠调用导致 Promise 永不 resolve

- **日期**：2026-08-17
- **模块**：`apps/web/src/components/CustomModal.tsx`
- **现象**：`showAlert` 直接覆盖模块级 `alertState`。若在前一个 Alert 未关闭时再次调用，前一个 Promise 的 `resolve` 被丢弃，永不 resolve，调用方 `await showAlert(...)` 永久挂起。
- **根因**：Alert 状态是单槽位，新调用无条件覆盖旧状态，旧 Promise 没有清理机制。
- **修复**：覆盖前先检查 `alertState?.isOpen`，若正在显示则先 `resolve(false)` 解决旧 Promise，再创建新的 alert。
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：模块级单槽位 UI 状态（Alert、Toast 等）在被覆盖时必须处理旧 Promise 的 resolve，否则会造成内存泄漏和调用栈挂起。可扩展为队列机制支持多条提示。

---

## #38 useProfilePage saveSettings 回滚使用闭包旧值

- **日期**：2026-08-17
- **模块**：`apps/web/src/hooks/useProfilePage.ts`
- **现象**：快速切换设置开关时，先发起的保存请求失败后，回滚使用的 `settings` 是闭包捕获的旧值，会覆盖掉期间成功的另一次保存。
- **根因**：`saveSettings` 的 catch 中 `setSettings(settings)` 使用的是闭包在函数调用时捕获的 `settings` 快照，不是最新值。
- **修复**：新增 `settingsSnapshotRef`，保存前快照当前 settings，回滚时使用快照而非闭包值。成功时同步更新 ref。
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：在异步操作中，闭包捕获的 state 值可能已过期。应使用 ref 存储最新值作为回滚基准，或使用 `setState(prev => ...)` 函数式更新确保基于最新状态。

---

## #39 FolderContext updateFolder / removeFolder 仅操作根层级

- **日期**：2026-08-17
- **模块**：`apps/web/src/contexts/FolderContext.tsx`
- **现象**：`updateFolder` 和 `removeFolder` 仅对顶层数组做 `map`/`filter`，嵌套子文件夹无法被更新或删除。
- **根因**：未递归处理 `children`，接口契约只覆盖根层级。
- **修复**：改为递归实现。`updateRecursive` 在 children 中查找并更新目标文件夹；`removeRecursive` 在 children 中查找并过滤目标文件夹。
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：操作树形/嵌套数据结构时（如文件夹树），必须递归处理所有层级，不能假设目标节点只在根层级。对于小数据量，递归实现足够清晰；超大数据量可考虑 `findIndex` + 路径定位。

---

## #40 Sidebar 回收站按钮无 onClick，是死按钮

- **日期**：2026-08-17
- **模块**：`apps/web/src/components/Sidebar.tsx`
- **现象**：侧栏底部"回收站"按钮只有样式，没有 `onClick`，点击无任何反应。
- **根因**：开发时遗漏绑定事件。
- **修复**：添加 `onClick={() => navigate('/trash')}`，使按钮导航到回收站页面。
- **验证**：`pnpm --filter @inkweaver/web typecheck` 通过
- **教训**：UI 组件中的按钮必须有明确的交互行为。代码审查时应关注无 onClick 的 button/链接元素，可通过 ESLint `jsx-a11y/click-events-have-key-events` 规则自动检测。
