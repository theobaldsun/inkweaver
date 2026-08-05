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
  1.（WEB-P1-01）切文档/卸载时 cleanup 调用 `leaveDocRoom(id)`，但 `joinDocRoom(id)` 仍在 `await connectSocket()` 中，`docRooms` 未包含该 id，`leaveDocRoom` 直接 return；后续 `joinDocRoom` 解析后仍 `emit('join-doc')`，房间被加入但永不离开，服务端持续向已离开的客户端推送 update
  2.（WEB-P2-01）`pull` 的 `while` 因 `hasMoreData === false` 成功退出后，仍执行 `if (Date.now() - startTime >= maxExecutionTime) throw`，丢弃已拉取的全部结果
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
