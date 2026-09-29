# Agent 核心逻辑与代码审阅指南

> 核对日期：2026-09-22。范围为当前工作树（包含已暂存、未暂存及未跟踪的 Agent 代码），不是仅比较最后一次提交。本文记录实际实现，不把开发计划当成已完成功能。
>
> 本轮目标：可从入口顺序读到数据库提交、恢复和界面刷新。除精确化注释外，不改变业务逻辑，不扩展到全仓 lint 修复。

## 阅读导航

- [整体概念](#1-先建立整体认识) · [推荐阅读顺序](#2-推荐代码阅读顺序)
- [模块与 HTTP 入口](#3-启动模块和入口) · [浏览器流程](#4-浏览器执行顺序) · [提交与去重](#5-提交去重及工作流版本)
- [调度循环](#6-唯一调度循环) · [Graph 节点](#7-graphrunner-与节点顺序) · [来源引用](#8-知识来源与引用)
- [模型与预算](#9-模型调用及预算) · [工具执行](#10-工具授权与执行链) · [恢复取消](#11-重试恢复与取消)
- [成果修订](#12-成果整稿修订与局部修订) · [确认保存](#13-保存完整顺序与事务边界)
- [状态与并发](#14-状态机事件和并发) · [读取导出](#15-读取sse-与导出清理) · [表与迁移](#16-数据表与迁移审阅)
- [文件职责](#17-核心文件职责索引) · [测试证据](#18-测试证据与推荐对照用例) · [审阅清单](#19-审阅时应主动挑战的边界)

## 1. 先建立整体认识

这是一个持久化的个人知识助手，不是“收到消息后直接调用一次模型”的接口。

- Thread：连续会话。
- Message：用户可见消息；用户消息触发 Run。
- Run：一次生成、修订或保存操作的业务生命周期。
- Graph：生成/检索的节点编排，Checkpoint 记录执行位置。
- ToolCall：逻辑工具调用；ToolAttempt：某一次实际执行。
- Source：本 Run 观察到的来源片段；不是原文的实时镜像。
- Artifact / ArtifactVersion：稳定成果及不可变版本；不是 documents 文档。
- DocumentSave：选定版本、目标目录、预留文档 ID 和保存事实。
- Confirmation：绑定用户、调用、参数和资源版本的批准记录。
- Event：Run 内有序的业务状态通知；不是模型 token 流。
- ModelCall：模型尝试及保守预算预占、实际用量观测。

核心分流：

~~~
浏览器 /ai
  → agentApi → AgentController（AuthGuard）
    ├─ 提交消息 → AgentService.submit → Message + Run + Event
    │              ↓ 定时调度 tick
    │          AgentGraphRunner → Graph → 模型 / 只读工具 → 成果 / 可见回复
    ├─ 准备保存 → AgentSaveService.prepare → 保存 Run + 固定绑定 + 待确认调用
    │              ↓ 用户批准 → decide → resume → tick
    │          AgentDocumentWriter → 单事务创建文档、同步快照、保存与调用结果
    ├─ 取消/恢复 → 持久化调度意图 → Worker 后续处理
    └─ 查询/SSE → 读取已提交事实 → 页面重读状态
~~~

必须区分：

| 容易混淆的概念 | 当前真实含义 |
|---|---|
| 目录中存在工具 | 仅表示已装配，不表示用户有权调用 |
| prepared | 参数和策略预检查通过，未完成资源授权/确认/领取 |
| APPROVED | 仍受有效期、绑定摘要和执行前复核约束 |
| cancelRequested | 取消意图，不是执行已停止或写入已撤销 |
| executionPaused | 调度暂停，不是 Run FAILED |
| Checkpoint 存在 | 有图恢复位置，不是业务结果或执行授权 |
| Artifact draft | 草稿版本，不是已保存文档 |
| DocumentSave SAVED | 文档事务已提交，不代表索引已完成 |
| evidence.items 为空 | 模型未报告问题，不等于事实已核实 |
| Reader snapshot | 页面聚合查询，不是同一数据库事务快照 |

## 2. 推荐代码阅读顺序

每阶段先读入口，再读下沉依赖；不需要按目录字母顺序阅读。

1. [AgentPage](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/web/src/pages/AgentPage.tsx) 与 [agentApi](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/packages/api/src/agent/agentApi.ts)：先确认用户实际能做什么。
2. [Controller](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent.controller.ts)：HTTP 参数、身份与响应边界。
3. [AgentService](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent.service.ts)：工作流选择、唯一调度循环、取消与恢复。
4. [ConversationStore](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-conversation.store.ts)：消息去重及 Run 创建事务。
5. [GraphRunner](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-graph.runner.ts) → [Graph](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-graph.ts)：业务端口和节点顺序。
6. Knowledge / Context / Source → ModelCallRecorder / ModelClient：来源、模型预算及外部调用边界。
7. Catalog → Policy → Preparer → Authorization → Executor：工具从“可发现”到“可执行”的逐层检查。
8. SaveService → DocumentSaveStore → DocumentWriter：用户批准后的实际写入。
9. Run/Tool 生命周期、Store/Writer、Event：状态转换和原子性。
10. Maintenance / Control / Retry → Reader / SSE → Export / Cleanup：异常、恢复和历史数据。
11. 数据库迁移及测试矩阵：验证代码中的保证在数据库约束下成立。

下文链接到文件，配合明确符号名定位；避免后续注释增减导致行号失效。

## 3. 启动、模块和入口

### 3.1 模块装配

入口：[AppModule](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/app.module.ts)、[AgentModule](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent.module.ts)。

- AppModule 在启用 TypeORM 的分支装配 AgentModule。
- AgentModule 导入 AuthModule、AiModule、SearchModule 和 TypeORM 实体映射。
- Nest providers 为 AgentModelClient、AgentKnowledgeService、AgentService。
- Store、Writer、Catalog、Runner 等由调用方以相应 manager 构造，不是每个文件都单独注册一个 Nest provider。
- AgentService 构造时通过 assembleV1Tools 注册 read_document v1 与 create_document v1。
- create_document 也是启动时装配；直到用户选定成果时才创建逻辑调用。
- AgentModelClient 启动时读取并校验 Agent 独立配置；本文不读取或复制环境密钥。
- createAgentCheckpointer 延迟创建，复用 TypeORM 的 PostgreSQL pool，只检查 checkpoint_migrations 的版本 [0,1,2,3,4]，不执行 setup 或迁移。
- onModuleDestroy 停止下一轮定时器，等待当前 pending；不自行销毁 TypeORM pool。

### 3.2 就绪状态不是全量验证

AgentService.status 只查询两个哨兵列：

- agent_runs.nextDispatchAt
- agent_document_saves.indexScheduledAt

返回 ready、modelConfigured、model、limits；不探测供应商网络。ready 为 true 不证明全部表、函数、触发器均正确，迁移和数据库验收仍不可省略。

### 3.3 HTTP 路由清单

全部在 /api/agent 下，类级 AuthGuard 和 AgentApiErrorFilter 生效。userId 由 getUserId(req.user) 提取，不接受正文中的 owner。

| 方法与路径 | Controller 方法 → 下一层 | 主要作用 |
|---|---|---|
| GET /status | status → AgentService.status | 配置及迁移哨兵状态 |
| GET /threads | threads → Reader.listThreads | 最近最多 100 个会话 |
| POST /threads | createThread → ConversationStore.createThread | 空会话，不执行模型 |
| GET /threads/:id | thread → Reader.threadDetail | 最近消息与运行 |
| POST /threads/:id/messages | submit → AgentService.submit | 文本请求，固定工作流 |
| POST /threads/:id/saves | save → AgentService.prepareSave | 指定版本和目录，准备确认 |
| GET /runs/:id | run → Reader.snapshot | 运行聚合视图 |
| POST /runs/:id/resume | resume → AgentService.resume | 原 Run 解暂停 |
| POST /runs/:id/cancel | cancel → AgentService.cancel | 先持久化取消意图 |
| POST /runs/:id/confirmations/:confirmationId | decide → AgentService.decide | accept 必须是 boolean |
| GET /runs/:id/events | events → EventReader.list | sequence > after 的事件分页 |
| GET /runs/:id/stream | stream → EventReader.list 循环 | 认证 SSE、游标和心跳 |

路径 UUID 使用 ParseUUIDPipe；正文最终由领域层验证。Controller 只转交选定字段，不允许客户端选模型地址、有效权限或 workflowVersion。

错误处理：HttpException 保留状态；其他异常仅暴露匹配稳定大写码的 message，否则 AGENT_REQUEST_FAILED。稳定码以 INVALID_ 开头时返回 400，其余 409；因此不是所有“包含 INVALID”的领域错误都映射为 400。

## 4. 浏览器执行顺序

入口路由：[App.tsx](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/web/src/App.tsx) 的 /ai → AgentPage。

1. 页面挂载：status；ready 后并行读取会话列表和目录树。
2. URL 保存 thread/run。切换时清空旧展示、终止旧订阅，防止旧请求更新新页面。
3. 无会话提交：先 createThread，再 submit；已有会话直接 submit。
4. keyFor 按 thread + 内容/模式/修订参数的 JSON signature 保持 requestKey。网络失败保留；参数变更换键；成功清空。
5. submit 成功只获得 Run，更新 URL，实际模型工作由服务端 tick 触发。
6. 读取 Thread 和 Run 后订阅 SSE。每个新 sequence 触发重新读取，不直接将事件正文拼成业务状态。
7. 同一次 effect 内保留 after；断开后约 2 秒重连。切换 Run 会重置游标；页面重载通过事实查询重建状态。
8. 心跳最多约每 5 秒触发一次重读，以发现没有状态事件的成果/调度字段变化。
9. 成果按文本显示，引用转内部文档链接，不执行模型 HTML。
10. 保存先展示版本预览，再批准确认；整稿/局部修订创建新的 task Run，不直接覆盖 documents。

agentApi.stream 使用共享 API Client 的 XHR 文本增量解析，凭据不放 URL。仅消费完整 SSE 帧，对递增序号去重；浏览器超时为 70 秒。

## 5. 提交、去重及工作流版本

AgentService.submit 先 ensureReady、检查模型已配置，再服务端选择：

| 条件（按优先级） | workflowVersion | 执行方式 |
|---|---|---|
| revisionTarget.range 存在 | agent-section-v1 | 局部修订 |
| revisionTarget 存在 | agent-revise-v1 | 整稿修订 |
| mode=task | agent-task-v2 | 检索、提纲、草稿、证据分析 |
| 其他合法 dialogue | agent-read-v1 | 检索与回答 |
| 保存 API | agent-save-v1 | 独立保存流程，无模型 |

Runner 兼容旧 agent-task-v1，但新普通任务使用 v2。版本是路径契约，不是模型自行选择的参数。

ConversationStore.appendUserMessageAndCreateRun：

1. 验证 UUID、requestKey（trim 后最多 128 字符）、mode、workflowVersion、修订目标。
2. parseAgentContentBlock 默认只开放 text；最多 64 块、JSON 总字节不超过 256 KiB，合并后的 goal 必须非空。
3. 对规范化内容、mode、workflowVersion、revisionTarget 求请求摘要。
4. 开 READ COMMITTED 事务，先 lockAgentOwner，再检查 Thread 归属与未归档。
5. 同 user/thread/requestKey 已存在：摘要相同则读取并核对原 Message↔Run 双向绑定；不同则 AGENT_REQUEST_KEY_CONFLICT。
6. 新修订请求核验所选基准仍为最新版；局部范围在创建时验证。
7. 插入用户消息，调用 AgentRunStore.create，新 Run 初态 CREATED。
8. 写入修订字段、RUN_CREATED 事件、消息 runId 及 Thread 活跃时间。
9. AgentService 仅对新请求设置 executionPaused=false；重放不解除原有错误暂停。

上述组合受最外层事务约束，不能把中间步骤当成已提交。appendAssistantMessage 本身是插入方法，不独立提供幂等键；其幂等性来自调用方的 Run 锁、终态检查和同事务 COMPLETE。

## 6. 唯一调度循环

AgentService.onModuleInit：首次约 2 秒后 tick，当前 tick 结束后再等待 2 秒。不是严格每 2 秒并发触发。

每轮 tick 的真实顺序：

1. status.ready=false 则返回。
2. 模型已配置时 dispatchIndexing，处理保存后的索引投递。
3. ToolExecutionMaintenance.runOnce：
   - recoverExpiredAll：恢复已过期只读 Attempt；
   - advanceDueRetries：到期 RETRY_WAIT → READY；
   - expireDue：待确认/已批准但尚未执行的确认过期处理。
4. 查询最多 10 个 executionPaused=false、到期且非终态的 Run，按 nextDispatchAt、id 排序。
5. 未配置模型时，只允许保存工作流或取消请求进入候选。
6. 对候选依次执行：取消优先，其次保存，否则 GraphRunner.run。
7. 正常返回后 nextDispatchAt 设置为数据库当前时间 + 2 秒。
8. AGENT_GRAPH_BUSY 跳过；其他错误设置稳定 lastErrorCode，并令 executionPaused=NOT cancelRequested。

这里的 SELECT 不是执行权领取。Graph 使用 advisory lock；保存依赖用户锁和持久化绑定。慢模型调用会推迟当前进程的后续候选以及下一轮维护；它不是并行任务队列。维护扫描或索引投递在候选循环之外失败时，整轮由外层捕获并记录 AGENT_DISPATCH_UNAVAILABLE，不逐个设置 Run 错误。

## 7. GraphRunner 与节点顺序

### 7.1 Runner 外围

AgentGraphRunner.run：

1. 用规范化 userId:runId 作为 checkpoint key；不是产品 Thread ID。
2. 独立 QueryRunner 连接持有 pg_try_advisory_lock(hashtextextended(key,0))。
3. 按 userId+runId 加载并验证支持的工作流及 mode；校验服务端 authorization 主体。
4. COMPLETED 直接返回，不重放模型。
5. 模型未配置在知识检索前拒绝。
6. CREATED → QUEUED → RUNNING，通过 RunWriter 产生状态事件。
7. 装配 Graph ports，读取 Checkpoint：
   - 无 createdAt：以 {} 初始化；
   - 有 interrupt：Command({resume:true})；
   - 普通未完成检查点：以 null 继续。
8. invoke 使用 recursionLimit=100、durability=sync。
9. finally 解 advisory lock 并释放连接。

guard 检查 signal、锁连接存活和最新 Run 是否允许继续；取消或非 RUNNING/WAITING_CONFIRMATION 会停止后续节点。权限不是从 Checkpoint 恢复，而由具体端口重新查询。

### 7.2 节点路线

~~~
START → initialize → model
                     ├─ tool_calls → tools → model（循环）
                     └─ answer
                         ├─ dialogue → finish → END
                         ├─ 新任务 → generateOutline → publishOutline → draft
                         │                               ↓
                         │           v2: reviewEvidence → publishDraft → finish
                         │           v1:                  publishDraft → finish
                         ├─ 整稿修订 → draft → publishDraft → finish
                         └─ 局部修订 → draft → assembleSection → publishDraft → finish
~~~

- round 对每个模型节点累加，不仅统计 tool loop；限制取 callsPerRun。
- synthesize 的提纲/草稿节点不向模型开放工具。
- 新任务无工具时通常是 4 次模型调用：检索后的 answer、outline、draft、evidence。工具循环会增加次数。
- 整稿/局部修订当前没有 reviewEvidence 节点，发布的 evidence 为 null，不应写成“所有草稿均分析证据”。
- tools 节点按提议顺序串行执行（单步最多 8 个），不是并发执行。
- 逻辑调用键为 graph-v1:round:index；供应商 toolCall.id 仅配对模型消息，不用作业务幂等键。
- paused 时 interrupt；恢复可能重跑节点，所以已提交工具结果必须按 callKey 复用。
- 生成与发布是独立节点：尽量先持久化生成状态，再幂等发布成果；Checkpoint 与业务事务不是一笔原子提交。

### 7.3 initialize 和 finish

initialize：

- 普通路径只读触发消息之前的最近 20 条历史，避免混入后来 Run 的输入。
- 整稿修订不带会话历史，避免旧引用标签混淆；加固定基准稿作为不可信 user 数据。
- 局部修订使用 prepareSectionContext，继承范围外历史引用映射。
- 从当前 Catalog 与策略交集固定工具版本；每次模型发现仍重新求交。

finish（一个 READ COMMITTED 事务）：

- 锁用户、检查 Run 仍 RUNNING 且未取消。
- 检查无非终态 ToolCall。
- 校验最终标签，并对比 Checkpoint citations 与数据库 usedInContext 来源映射。
- 复核最终引用文档当前可访问性。
- 更新 cited、写助手消息、Run COMPLETE 和对应事件一起提交。
- 若 Run 已 COMPLETED 返回，避免业务提交成功而 Checkpoint 未完成时重复写回复。

## 8. 知识、来源与引用

入口：[KnowledgeService](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-knowledge.service.ts)、[Context](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-context.ts)、[SourceStore](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-source.store.ts)。

- collect 并行调用 RagService.retrieve 与 SearchService.hybridSearch。
- 单路失败降级；两路失败报 AGENT_KNOWLEDGE_UNAVAILABLE。
- 默认 RAG 8、搜索 12、最终来源 8；可配置上限分别为 20、100、20。
- 按 docId 合并，RAG 同文档取更高分候选，搜索补充缺失文档；不是拼接全文。
- 最终查询 documents.userId 和 deletedAt，剔除失去归属或已删除候选。
- snapshot sourceKey 包含文档 ID、更新时间及片段摘要；同键不覆盖历史。
- Context 优先保留系统规则与当前目标；历史使用剩余额度约 30%，来源使用余量。
- Token 是启发式估算，不是供应商计费；裁剪使用 Unicode code point，附裁剪标记。
- markContext 同事务写 usedInContext 和 S1… 标签；候选来源不等于已进入上下文，更不等于最终引用。
- 检索索引可能滞后，documentUpdatedAt 不证明 excerpt 一定是最新正文。

read_document 成功后由 [AgentToolSourceStore](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-tool-source.store.ts) 从已提交的 Attempt result 捕获来源，不重读新正文替换旧结果：

- 按 callId 幂等，新增标签接在已有标签后，不重排。
- 最多 20 个标签；工具正文片段先限 6000 字符，再估算裁剪至 1500 Token。
- 空正文不生成来源；模型收到明确通知。
- 正文摘要 documentVersion 保留，时间可为 null。

[Citations](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-citations.ts) 只保证标签语法、唯一性和映射存在；代码块中的 [S...] 同样是保留语法。它不证明某句话被来源语义支持。

[Evidence](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-evidence.ts) 仅接受完整 JSON，固定 unverified；最多 20 项，conflict 至少两个不同来源，gap 可无来源，整体最多 64 KiB。null 与“已分析但 items 为空”必须区别展示。

## 9. 模型调用及预算

入口：[ModelCallRecorder](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-model-call.recorder.ts)、[ModelClient](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-model.client.ts)、[ModelConfig](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-model.config.ts)。

1. Recorder 校验 user/run、根 manager，禁止携带活跃外层事务调用模型。
2. 用户锁下检查 RUNNING、Run 调用次数、UTC 自然日调用次数及两级预占 Token。
3. 插入 STARTED 模型审计，预占为当前 contextTokens；提交短事务。
4. 事务外 client.step。
5. Client 校验消息配对、工具集合、上下文及输出预算；地址/模型/密钥引用仅来自服务配置。
6. ChatOpenAI maxRetries=0，关闭 SDK 隐式重试；parallel_tool_calls=false。
7. 工具描述仅发送名称、描述和输入 Schema，不发送权限、实现版本、来源配置或执行函数。
8. 最多 8 个工具提议；未知工具、重复 ID、坏参数协议拒绝，不降级成普通回答。
9. 成功/失败后独立短事务结算审计；未知 Token 保留 null，实际用量与预占分开。
10. 成功响应后的审计落库失败保留 STARTED，不冒充模型失败或零费用。

重要限制：模型响应与 Checkpoint 之间没有跨系统 exactly-once。崩溃后可能重新请求模型并产生真实新费用/审计记录；预算不会因 resume、失败或未知结果被清零。

## 10. 工具授权与执行链

### 10.1 分层职责

| 层 | 检查内容 | 不负责什么 |
|---|---|---|
| ToolDefinition / validator | 描述字段、JSON 可传输性、稳定错误码 | 用户权限 |
| ToolSchemaValidator | Ajv 2020-12 严格编译，参数/结果验证 | 资源、预算 |
| ToolCatalog | 定义+实现匹配，编译后发布，复制描述 | 执行许可 |
| ToolPolicy / ToolLookup | 身份、白名单、版本、风险、MCP 连接、权限 | 具体资源、确认 |
| ToolCallPreparer | Policy → resolve → 输入副本 Schema 校验 | 执行 |
| ToolCallStore | 固定调用快照、去重、状态/Attempt/Event | 证明授权事实 |
| ToolAuthorization | 当前策略、资源、摘要、确认有效期 | 实际适配器调用 |
| ToolExecutor | 只读领取、租约、事务外执行、结算 | 本地原子写文档 |
| AgentDocumentWriter | 已确认写工具的单事务业务写入 | 通用远程工具执行 |

Catalog 不再套一层 ToolRegistry。ToolRegistryError 名字保留，仍承载 INVALID_DEFINITION/DUPLICATE_TOOL；不是一个仍存活的第二注册表。

### 10.2 授权与确认摘要

[ToolResources](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-resources.ts)：

- document：读取 title/content/folderId，检查 owner 和未删除，求摘要。
- folder：读取 name/parentId 并检查 owner，求摘要。
- library：必须是当前 userId 且在范围内，版本为 owned-library-v1。
- scope 不隐式扩展 folder 后代。
- bindingDigest 对对象键排序、保留数组顺序，生成 SHA-256；不是凭据。

[ToolAuthorization](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-authorization.ts)：

- authorize：PREPARED → READY 或 WAITING_CONFIRMATION；需要确认时写 PENDING，默认 5 分钟，重复不刷新有效期。
- decide：严格 boolean；批准前复核绑定，过期落 EXPIRED；相同决定幂等，冲突决定报错。
- recheck：要求 READY、未取消、Run RUNNING；重新校验策略、参数、资源及 APPROVED/未过期/摘要一致。
- expire：仅待确认或 READY 可安全过期，不把 EXECUTING 标成停止。

### 10.3 ToolExecutor 三阶段

入口：[ToolExecutor](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-executor.ts)。

**领取事务**：用户锁 → recheck → 限 builtin/L0/read → 预算 → START → 新 Attempt → 租约 → RESERVED。

**事务外调用**：

- 重新 resolve，比较执行函数是否与领取时一致。
- 持久化 invocationStartedAt 后才调用适配器；取消已提交则不越过边界。
- 默认租约 5 秒、心跳 1 秒；续租失败/租约丢失立即 fail closed。
- 超时 Promise.race，AbortController 通知；不会保证底层已停止。
- 输出 JSON 序列化、字节上限、Schema 检查。

**结算事务**：用户锁 → 当前 Attempt 代次/owner/未过期租约 → 成功/失败/重试/取消状态 → result → 预算 SETTLED 或 RELEASED → 清 leaseOwner。

invocationStartedAt 非 null 按已越过调用边界处理，即使刚记边界就崩溃也保守结算。迟到响应不能由旧 Worker 回写新 Attempt。

read_document v1：10 秒超时、256 KiB 输出上限、safe 重试；执行时再次核对文档内容/位置摘要。supportsCancellation=false，表示不承诺中断 SQL；实现仍在调用前后检查 signal。

## 11. 重试、恢复与取消

入口：[Retry](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-retry.ts)、[Control](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-execution-control.ts)、[Maintenance](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-execution-maintenance.ts)。

- ToolRetryPolicy 是 Executor 与 Control 共用的退避规则；默认最多 3 次尝试，基数 250ms、上限 5000ms。
- delay = min(maxDelay, baseDelay × 2^(attemptCount-1))，attemptCount 持久化，重启不清零。
- 截止时间使用 PostgreSQL clock_timestamp，不用应用时钟裁决到期。
- 活执行器可等待退避再重试；维护扫描也可推进到期状态。两者共用 advanceDueRetry。
- RETRY_DUE 只推回 READY，不能直接调用适配器；下一次必须重新授权/预算/领取。
- recoverExpired 只处理 RESERVED + builtin_read + STARTED + 过期 lease，未知写工具不自动重放。
- 已越过调用边界的安全只读恢复先记录 OUTCOME_UNKNOWN，再经可信定义确定可安全重试。
- 无 Catalog 或不满足安全策略只收尾，不主动安排重试。
- ToolExecutionRegistry 仅是进程内 AbortController 桥接，不是持久化状态；跨进程取消依赖数据库标记和心跳。

Run 取消顺序：

1. AgentService.cancel 先锁用户写 Run cancelRequested=true、解除暂停、安排调度。
2. 逐调用 ToolExecutionControl.cancel。执行前可直接 CANCELLED；执行中只记录意图并通知本进程。
3. tick 优先 settleCancellation，争取同 Graph 会话锁，检查无非终态调用后 Run CANCELLED。
4. 不删除已发布成果，也不回滚已保存文档。
5. 当前 tick 调 Runner 未传入可由 cancel API 触发的 AbortSignal，所以模型在途取消主要在响应后/超时后由 guard 收敛，不承诺立即停止供应商请求。
6. resume 只是重新调度同一 Run，不能用来签发批准、克隆工作或重置预算。

## 12. 成果、整稿修订与局部修订

入口：[ArtifactStore](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-artifact.store.ts)、[Revision](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-artifact-revision.ts)、[Range](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-revision-range.ts)、[SectionContext](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-section-context.ts)。

- 新任务 artifactId 复用 Run UUID；普通提纲 v1、草稿 v2。
- publish 要求 RUNNING task，同用户同 Thread；版本最多 50，Thread 成果最多 20，正文最多 256 KiB。
- digest 包括内容、版本、Run 和引用（以及存在的 evidence）。同版本同摘要重放返回既有版本；不同摘要或过时基准冲突。
- 标题/正文引用与证据问题引用都进入版本来源关系，保存时全部重新检查可访问性。
- 整稿修订固定 artifactId/baseVersion，将历史标签替换为“历史引用待重新核实”，使用本 Run 来源重新引用。
- 若其他 Run 发布新版本则冲突；如果是本 Run 已发布 base+1，允许幂等恢复。
- 局部修订范围来自 textarea selectionStart/selectionEnd，是 UTF-16 半开区间。
- validateRevisionRange 拒绝越界、切开代理对、CRLF 或引用标签。
- prepareSectionContext 保留旧标签为本 Run 的历史来源，新候选标签接在其后；历史片段不是最新原文保证。
- 模型只生成 replacement；服务端 applyRevisionRange 拼 prefix + replacement + suffix。
- ArtifactStore 再执行 assertRevisionBoundary，约束持久化内容不能改变范围外字符及原标题。
- 局部修订“边界不变”由代码保证；整稿修订“只改要求涉及内容”主要是提示词要求，不是逐字约束。

## 13. 保存完整顺序与事务边界

入口：[SaveService](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-save.service.ts) → [SaveStore](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-document-save.store.ts) → [DocumentWriter](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-document.writer.ts)。

### 13.1 prepare：不写 documents

一个组合事务中：

1. 锁用户，创建保存请求消息与 agent-save-v1 Run。
2. 重放返回既有 Run 和 Save，不新增确认或文档 ID。
3. Run ENQUEUE → START。
4. SaveStore.prepare 验证固定 draft 版本属于同 Thread、目标目录及版本来源当前可访问。
5. 保存摘要绑定 artifactVersionId、artifactDigest、folderId；预留 documentId。
6. 同一版本不允许通过另一键/另一 Run 再绑定第二文档。
7. Preparer 准备 create_document v1，输入仅为 saveId/saveDigest/folderId，不含客户端正文。
8. ToolCallStore.create 使用 save:saveId 逻辑键。
9. authorize 创建 PENDING，Run WAITING_CONFIRMATION。

### 13.2 批准和调度

用户决定 → ToolAuthorization.decide → APPROVED 时 AgentService.resume；否则 cancel。确认决策提交与 resume 是前后两个调用，不是同一事务。之后 tick 的保存分支进入 execute。

SaveService.execute 要求调用 READY 或 SUCCEEDED；先将 WAITING_CONFIRMATION → QUEUED → RUNNING，再调用 DocumentWriter。

### 13.3 原子文档提交

DocumentWriter.save 只允许根 manager；自己开启 READ COMMITTED、statement_timeout=10s。

1. 用户锁、加载固定 Save。
2. 已 SAVED：核对 savedCallId、调用 SUCCEEDED/committed、原 documentId 仍存在且未删除，然后返回；不重建被删文档。
3. 未保存：检查 Run 取消意图、Authorization.recheck。
4. 限定可信 create_document v1、builtin、L1、必须确认，核对输入绑定。
5. SaveStore.verify 只复核，不预留新文档、不另起事务；内部锁 Run，校验原版本、目录和来源。
6. 验证 output、工具预算，ToolCall START 并创建 Attempt。
7. INSERT documents（禁止 upsert 覆盖既有文档），生成 docTsv。
8. 同一 Markdown 正文生成 Yjs content/metadata；写 SyncUpdate 和 DocSnapshot，快照 version 使用 updateId。
9. Save → SAVED，记录 savedCallId。
10. Call/Attempt → SUCCEEDED，sideEffect=committed；插入工具结果及 SETTLED/builtin_write_atomic 预算。
11. 全部提交或全部回滚，没有事务外写适配器。

随后 SaveService 独立事务写“已保存文档”助手消息及 Run COMPLETE。文档提交后、Run 收尾前崩溃，可复用保存事实完成收尾。

### 13.4 索引与存储配额

- dispatchIndexing 从 SAVED 且 indexScheduledAt IS NULL 的保存事实投递。
- 用文档当前内容，不使用准备时旧副本；删除文档不重新构建。
- scheduleReindex 成功后标记已投递；投递后崩溃可再次投递，依赖队列固定文档键去重。
- 当前该步骤受 model.isConfigured 门控，模型关闭时保存仍可完成，索引投递会延后。
- indexScheduledAt 是投递标记，不是索引计算完成证明。
- [Storage 迁移](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/migrations/1791158400000-AddAgentStorageAndIndexing.ts) 为消息、来源、成果、工具结果和 Checkpoint 内容设置配额触发器。
- agent_storage_bytes 聚合逻辑序列化字节，并非 PostgreSQL 磁盘占用。agent_check_storage 加上 documents 和同步数据，锁用户并超额拒绝。
- [StorageUsageService](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/storage/storage-usage.service.ts) 将 Agent 逻辑字节纳入既有用户统计。

## 14. 状态机、事件和并发

### 14.1 Run 状态机

[RunLifecycle](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run-lifecycle.ts)：

~~~
CREATED --ENQUEUE--> QUEUED --START--> RUNNING --COMPLETE--> COMPLETED
                                      |
                            WAIT_FOR_CONFIRMATION
                                      ↓
                              WAITING_CONFIRMATION
                                      |
                             CONFIRMATION_ACCEPTED
                                      ↓
                                   QUEUED
非终态 --已核验 FAIL / CANCEL_SETTLED / TIMEOUT_SETTLED--> 对应终态
~~~

FAILED/CANCELLED/TIMED_OUT/COMPLETED 不接受新状态事件。定时器触发本身不证明 TIMEOUT_SETTLED；当前业务调度错误通常是暂停，不是直接 FAILED。

### 14.2 ToolCall 状态机

[ToolCallLifecycle](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-call-lifecycle.ts)：

~~~
PREPARED --RESOURCES_APPROVED--> READY 或 WAITING_CONFIRMATION
WAITING_CONFIRMATION --CONFIRMED--> READY
READY --START--> EXECUTING（attemptCount + 1，sideEffect=unknown）
EXECUTING → SUCCEEDED / FAILED / OUTCOME_UNKNOWN / RETRY_WAIT
OUTCOME_UNKNOWN → 对账终态或有保证的 RETRY_WAIT
RETRY_WAIT --RETRY_DUE--> READY
~~~

执行前取消可终态；执行中/未知副作用取消必须继续处理。EXPIRED 不允许直接终止在途执行。状态机只判断迁移形式合法，证明事实属于 Authorization/Executor/Writer/Control。

### 14.3 三类计数不要混用

- Run.revision：Run 状态 CAS 版本。
- ToolCall.revision：逻辑调用状态 CAS 版本。
- lastEventSequence：Run 内所有 Run/Tool 事件共用的流游标。
- attemptCount：逻辑工具已启动次数，不能拿 revision 代替。

[RunStore](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run.store.ts) 原子比较 userId/id/status/revision；
[RunWriter](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run.writer.ts) 将状态与事件组合；
[ToolCallStore](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-call.store.ts) 将调用 CAS、[AttemptWriter](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-attempt.writer.ts) 和事件组合。

[appendAgentEvent](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-event.writer.ts) 要求活跃事务；CTE 增加 lastEventSequence 并插入事件，任何失败回滚业务及序号。

锁层次：

| 场景 | 主要并发裁决 |
|---|---|
| Graph 与取消收尾 | 同 userId:runId 的会话 advisory lock |
| Agent 业务写与用户清理 | users 行锁先行，再 Run/调用等业务行 |
| Run/Tool 状态更新 | 旧 status/revision 的条件 UPDATE |
| 工具迟到结果 | attemptId+代次+leaseOwner+未过期 |
| 保存重复请求 | 固定 Save/版本/文档 ID、事务与唯一约束 |
| Checkpoint 内容配额 | 触发器内用户锁及逻辑存储统计 |

外部模型、只读适配器执行期间不持有业务事务；Graph 会保持独立会话锁连接。此结构有意保留，不应为了“少文件”把三阶段执行合成一个长事务。

## 15. 读取、SSE 与导出清理

### 15.1 页面视图

[RunReader](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run.reader.ts)：

- listThreads 最近 100 个；
- threadDetail 最近 100 消息倒序取后反转，最近 100 Run；
- snapshot 先读取 ownedRun，再并行查来源、版本、确认、Save 预览和模型审计；
- 行类型从 Entity/领域接口 Pick，保留 null；
- 多查询无统一事务，可能短暂跨提交时点，不能用它证明原子一致性；
- 读取不推进状态；重读由页面事件/心跳触发。

Controller.stream 每用户每进程最多 4 条连接，最长 60 秒且不超过 token 到期；Last-Event-ID 优先于 after。每批 100 条，有更多立即续读，否则 1 秒后继续；无事件发 heartbeat，不代表 Run 结束。

[EventReader](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-event.reader.ts) 按 sequence > after，多取一条判断 hasMore；不跳过坏事件正文。无权/不存在/无事件均可返回空页；SSE 入口另做 ownedRun 校验。

### 15.2 导出和清理

[UserDataService](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/users/user-data.service.ts) 接入：

- [exportAgentData](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-data.exporter.ts)：Agent 数据本身在 REPEATABLE READ 中导出，按 userId 过滤，Checkpoint blob 转 base64，不执行反序列化对象。不代表整个账户各模块导出共享同一事务。
- [deleteAgentData](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-data.cleanup.ts)：在用户清理事务中先锁用户，未结束 Run（包括暂停 Run）阻止清理；删除 Run/Thread 并由外键级联派生数据。
- 未迁移环境可兼容空 Agent 数据；检测到相关表不完整时失败，不静默忽略查询故障。
- 导出保留来源、工具参数/结果等用户私有内容，不适合原样写诊断日志或发送第三方。

## 16. 数据表与迁移审阅

实体只映射部分数据库结构；没有 Entity 的事件、确认、结果、预算及框架表同样需要审阅 SQL。迁移由显式流程执行，服务启动不自动建表。

| 对象 | 业务归属与审阅要点 |
|---|---|
| agent_threads / agent_messages | 会话归属；requestKey、触发消息和 Run 关联 |
| agent_runs / agent_events | 状态/revision/sequence、调度字段、事件级联 |
| agent_tool_calls / agent_tool_attempts | 固定输入、来源、调用键、代次、租约 |
| agent_confirmations | 调用绑定、摘要、有效期和决定 |
| agent_tool_results / agent_budget_reservations | 每 Attempt 结果、边界前后预算结算 |
| agent_run_sources | 候选/使用/最终引用、文档片段及继承来源 |
| agent_model_calls | STARTED 先提交、用量 nullable、预占预算 |
| agent_artifacts / agent_artifact_versions / agent_artifact_sources | 稳定成果、追加版本、冻结引用关系 |
| agent_document_saves | 版本唯一保存绑定、预留文档、提交和索引投递标记 |
| agent_checkpoint.* | migrations/checkpoints/blobs/writes，与 Run checkpointKey 关联 |
| documents / sync_update / doc_snapshot | 保存目标及 Yjs 一致初始化 |

按迁移号阅读 [migrations 目录](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/migrations)：

| 顺序 | 迁移 | 核心增量 |
|---|---|---|
| 1 | 1789344000000 CreateAgentRuns | Run 基础结构与约束 |
| 2 | 1789344001000 CreateAgentEvents | 业务事件 |
| 3 | 1789430400000 AddAgentEventSequence | Run 内连续游标 |
| 4 | 1789430401000 CreateAgentToolCalls | 逻辑调用 |
| 5 | 1789516800000 CreateAgentToolAttempts | 独立执行代次 |
| 6 | 1789603200000 CreateAgentConfirmations | 确认绑定 |
| 7 | 1789689600000 AddAgentReadExecution | 只读结果、预算 |
| 8 | 1789776000000 AddAgentExecutionRecovery | 租约与调用边界 |
| 9 | 1789862400000 AddAgentRetryScheduling | 退避截止 |
| 10 | 1789948800000 CreateAgentConversations | 会话、消息与 Run 关联 |
| 11 | 1790035200000 CreateAgentRunSources | 来源快照 |
| 12 | 1790121600000 CreateAgentCheckpoints | 独立 checkpoint schema |
| 13 | 1790208000000 AddAgentSourceCitationLabels | 来源标签 |
| 14 | 1790294400000 CreateAgentModelCalls | 模型审计 |
| 15 | 1790380800000 AddAgentToolSources | 工具结果来源 |
| 16 | 1790467200000 CreateAgentArtifacts | 成果版本及引用 |
| 17 | 1790553600000 AddAgentRevisionTarget | 固定整稿基准 |
| 18 | 1790640000000 AddAgentRevisionRange | 固定局部范围及继承来源 |
| 19 | 1790726400000 AddAgentArtifactEvidence | 证据问题结构 |
| 20 | 1790812800000 CreateAgentDocumentSaves | 保存绑定 |
| 21 | 1790899200000 AddAgentDocumentSaveCommit | 保存提交调用关联 |
| 22 | 1790985600000 AddAgentModelBudgets | 模型预算预占 |
| 23 | 1791072000000 AddAgentDispatch | 耐久调度与暂停/取消意图 |
| 24 | 1791158400000 AddAgentStorageAndIndexing | 内容配额与索引投递 |

不要通过改 CREATE SCHEMA 为 IF NOT EXISTS 来掩盖测试污染：它可能留下与新迁移不兼容的旧表/函数。测试修复是在固定本地测试库重建 schema，生产迁移未因此放宽。

## 17. 核心文件职责索引

Agent 模块当前 98 个 TypeScript 文件：63 个非测试、35 个测试（其中 4 个集成测试文件）。数字只描述结构，不代表 98 层调用。

以下名称相对 [Agent 模块目录](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent)；以源码导入和本指南路径为准。

| 文件/组 | 核心责任 |
|---|---|
| agent.module / agent.controller / agent.service | 装配、HTTP、调度 |
| agent-conversation.store | 会话和消息/Run 请求幂等 |
| agent-run-lifecycle / agent-run.store / agent-run.writer | 纯规则、条件更新、事务事件 |
| agent-run.reader | 页面只读聚合 |
| agent-event / agent-event.writer / agent-event.reader | 事件协议、序号提交、分页 |
| agent-graph / agent-graph.runner / agent-checkpointer | 图定义、业务端口、框架存储适配 |
| agent-model.config / agent-model.client / agent-model-call.recorder / agent-model-tools | 配置、外部协议、审计预算、消息配对和发现 |
| agent-knowledge.service / agent-context / agent-source.store / agent-tool-source.store | 检索、预算上下文、候选和工具来源 |
| agent-citations / agent-evidence | 引用结构、待核实证据结构 |
| agent-artifact.store / agent-artifact-revision / agent-revision-range / agent-section-context | 版本、基准、字符范围、继承来源 |
| agent-save.service / agent-document-save.store / agent-document.writer | 保存编排、固定绑定、原子业务写 |
| agent-data.cleanup / agent-data.exporter | 用户清理协调、可重复读导出 |
| tools/tool-definition / tool-definition-validator / tool-schema-validator | 描述契约、结构校验、Ajv |
| tools/tool-catalog / tool-policy / tool-call-preparer | 装配、有效策略、输入准备 |
| tools/tool-resources / tool-authorization | 资源快照与确认 |
| tools/tool-call-lifecycle / tool-call.store / tool-attempt.writer / tool-call-event | 生命周期、调用和代次持久化、事件正文校验 |
| tools/tool-executor / tool-execution-control / tool-execution-maintenance / tool-retry | 执行、取消恢复、单轮维护、共同退避 |
| tools/tool-execution-registry | 同进程取消桥接 |
| tools/read-document.tool / create-document.tool | 两个可信工具契约和适配边界 |
| entity/*.entity.ts（11 个） | Run、Thread、Message、Call、Attempt、Source、ModelCall、Artifact、Version、ArtifactSource、DocumentSave 的实体映射 |

> 实体数量和枚举详见附录 A；不应依据实体数量推算数据库表数量。

## 18. 测试证据与推荐对照用例

### 18.1 本会话已实际取得的证据

- server 普通测试：228 项，221 通过、0 失败、7 跳过（集成开关关闭时）。
- 完整集成：修复后连续两轮 23 通过、0 失败、0 跳过。
- 23 包括 7 个顶层测试及工具持久化内 16 个子测试，不是 23 个文件。
- 全仓 typecheck、server lint、nest build 通过；全仓 lint 有未修改模块既有错误，不能声明全仓 lint 清零。
- 使用本地测试 PostgreSQL/Redis/MinIO 与模型替身，未证明真实供应商兼容、模型质量、性能上限或所有崩溃时点。
- 本轮文档/注释修改后的复核结果另在交付说明中报告。

### 18.2 集成入口

[run-integration-tests.mjs](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/scripts/run-integration-tests.mjs) 显式列出七个编译后的文件，以 test-concurrency=1 串行执行并设置 RUN_INTEGRATION_TESTS=1。

| 文件 | 重点验证 |
|---|---|
| [agent-runs.integration.test](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-runs.integration.test.ts) | Run 归属、状态约束、修订竞争、级联 |
| [agent-conversation.persistence.integration.test](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-conversation.persistence.integration.test.ts) | 请求去重、消息绑定、导出清理 |
| [agent-v1.persistence.integration.test](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-v1.persistence.integration.test.ts) | 完整迁移、离线生成、确认保存、幂等、配额、取消 |
| [tool-call.persistence.integration.test](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-call.persistence.integration.test.ts) | 多连接竞争、原子事件、租约、取消、重试和维护 |
| [core-http.integration.test](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/core-http.integration.test.ts) | 既有账户/文档/对象存储 HTTP 闭环，不是 Agent 浏览器 E2E |
| [sync.integration.test](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/sync/sync.integration.test.ts) | Yjs REST push、快照与增量 |
| [data-integrity.integration.test](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/users/data-integrity.integration.test.ts) | 迁移回退重放、认证并发、账户清理 |

Agent v1 仍接受旧 RUN_AGENT_V1_INTEGRATION=1；统一脚本不依赖旧开关。

测试数据库固定为 127.0.0.1:5433/syncbox_test，Redis 6380，MinIO 9002。HTTP/用户完整性测试会删除 checkpoint schema 并重建 public schema，不能修改连接为业务库或并行运行。

已修复的测试问题见 [Issue #53](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/docs/Issue.md)：TypeORM 清理遗漏 schema/函数；回退迁移不再假定目标是最后一条，改为回退目标及其后续迁移并验证完整重放序列。

### 18.3 单元测试阅读路线

1. agent-run-lifecycle、tool-call-lifecycle：枚举终态与非法事件。
2. agent-run.writer、tool-call.store、tool-attempt 相关测试：CAS、事件失败回滚、代次绑定。
3. tool-definition-validator、tool-catalog、tool-policy、tool-call-preparer：四层职责不混淆。
4. tool-retry：退避边界和并发推进。
5. agent-model.client、agent-model-call.recorder、agent-graph：协议、用量和检查点恢复。
6. agent-context、agent-citations、agent-evidence、agent-tool-source.store：预算、标签与来源冻结。
7. agent-artifact.store、agent-artifact-revision、agent-revision-range、agent-section-context：固定版本与局部边界。
8. agent-document-save.store、agent-document.writer：准备/verify、原子保存和重放。
9. agent-data.exporter、agent-data.cleanup、agent-event.reader：一致导出、未结束任务和分页。

## 19. 审阅时应主动挑战的边界

这些是代码现状/审阅关注点，不代表本轮已经修复或判定为缺陷。

- [ ] status.ready 只检查哨兵列；部署是否有完整迁移门禁？
- [ ] tick 串行处理最多 10 个候选，慢模型会拖延其他任务；当前吞吐是否符合目标？
- [ ] Graph 持有独立连接的会话锁，连接池容量是否容纳业务、模型等待和 Checkpoint？
- [ ] 原子业务事务与 Checkpoint 非原子，是否接受模型重复调用的费用语义？
- [ ] 新任务已有一次 answer 后还生成 outline/draft/evidence，最低调用预算是否充分？
- [ ] 模型关闭时保存可执行、索引暂不投递，这是否符合产品预期？
- [ ] 取消在途模型不是实时中断；UI 是否仅显示“正在取消”而不声称已停止？
- [ ] 待确认保存会被 tick 尝试并可能因未批准暂停，批准后 resume 才恢复；该状态展示是否容易误导用户？
- [ ] Reader 多查询最终一致，事件没有覆盖全部成果/调度字段，页面需要心跳重读。
- [ ] shared 允许表达媒体类型不等于 Agent 已有媒体处理能力；当前消息入口仍仅 text。
- [ ] API 客户端的部分 view 比服务端 Entity 更窄（如 message.runId nullable 差异），兼容旧记录时需对照。
- [ ] 检索片段新鲜度与引用语义真实性没有被结构校验解决。
- [ ] 整稿修订依靠提示词约束改动范围；局部修订才有代码级范围保护。
- [ ] ModelClient.extractAgentModelText 会 trim 文本，局部 replacement 的首尾换行不保证保留；范围外不变不等于片段拼接排版一定正确。
- [ ] create_document 的通用 execute 故意报错，不能在重构时把它接入只读 Executor。
- [ ] 模型失败留 STARTED 或暂停记录时，不得把 null 用量当零费用。
- [ ] 同一成果版本只绑定一次保存：拒绝/过期后改键重存的产品体验需专门审阅，不能假设自动重新准备。
- [ ] Run TIMED_OUT 作为领域状态存在，不等于系统已实现任意全局 Run 超时任务。
- [ ] MCP 仅留契约；Graph/Executor 还有 builtin 限制，不能只增加一个 adapter 就宣称接入完成。
- [ ] 全仓 lint 和真实 Agent 浏览器交互/供应商调用不在已通过的集成证据里。

## 20. 本轮注释校准原则

- 修正“未来接入 API/Graph/执行层”等过时描述。
- 说明 ToolLookup 只是目录读视图、Catalog 不是授权。
- 说明 tick 候选查询不是领取，慢调用串行影响调度。
- 说明 Reader 聚合查询不是原子快照。
- 修正 create_document 装配时机与 Checkpointer pool 生命周期。
- 保留有意兼容的旧工作流/开关及错误名称，不为命名重构业务。
- 不在注释中承诺 exactly-once 模型调用、立即取消、最新索引或已经核实的证据。

审阅完成标准：能逐条指出“谁创建业务 ID、谁证明权限、在哪个事务提交、失败后从哪里重放、何时可落终态、界面如何看到结果”，而不是只看文件数量或方法命名。

## 附录 A. 非测试文件逐项导航

以下清单直接对照当前目录生成，覆盖全部 63 个非测试 TypeScript 文件；接口/类型为主的文件没有可调用入口。

| 文件 | 类/函数入口 |
|---|---|
| [agent-artifact-revision.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-artifact-revision.ts) | revisionMaterial、loadAgentRevision |
| [agent-artifact.store.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-artifact.store.ts) | AgentArtifactStore |
| [agent-checkpointer.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-checkpointer.ts) | createAgentCheckpointer |
| [agent-citations.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-citations.ts) | validateAgentCitations |
| [agent-context.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-context.ts) | AgentContextError、estimateAgentTokens、truncateAgentText、prepareAgentContext |
| [agent-conversation.store.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-conversation.store.ts) | AgentConversationStoreError、AgentConversationStore |
| [agent-data.cleanup.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-data.cleanup.ts) | lockAgentOwner、deleteAgentData |
| [agent-data.exporter.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-data.exporter.ts) | exportAgentData |
| [agent-document-save.store.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-document-save.store.ts) | AgentDocumentSaveStore |
| [agent-document.writer.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-document.writer.ts) | createAgentDocumentSnapshot、AgentDocumentWriter |
| [agent-event.reader.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-event.reader.ts) | AgentEventReader |
| [agent-event.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-event.ts) | AgentEventValidationError、parseAgentEventBody |
| [agent-event.writer.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-event.writer.ts) | appendAgentEvent |
| [agent-evidence.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-evidence.ts) | parseAgentEvidenceReport、parseAgentEvidenceText |
| [agent-graph.runner.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-graph.runner.ts) | agentCheckpointKey、AgentGraphRunner |
| [agent-graph.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-graph.ts) | createAgentGraph |
| [agent-knowledge.service.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-knowledge.service.ts) | AgentKnowledgeError、AgentKnowledgeService |
| [agent-model-call.recorder.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-model-call.recorder.ts) | AgentModelCallRecorder |
| [agent-model-tools.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-model-tools.ts) | AgentModelProtocolError、validateModelToolCall、selectAgentModelTools、toAgentModelMessages |
| [agent-model.client.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-model.client.ts) | parseAgentModelDecision、normalizeAgentTokenCount、AgentModelError、extractAgentModelText、AgentModelClient |
| [agent-model.config.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-model.config.ts) | parseAgentModelConfiguration、loadAgentModelConfiguration |
| [agent-revision-range.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-revision-range.ts) | validateRevisionRange、applyRevisionRange、assertRevisionBoundary |
| [agent-run-lifecycle.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run-lifecycle.ts) | AgentRunTransitionError、isAgentRunTerminal、transitionAgentRun |
| [agent-run.reader.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run.reader.ts) | AgentRunReader |
| [agent-run.store.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run.store.ts) | AgentRunStoreError、AgentRunStore |
| [agent-run.writer.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-run.writer.ts) | AgentRunWriter |
| [agent-save.service.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-save.service.ts) | AgentSaveService |
| [agent-section-context.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-section-context.ts) | prepareSectionContext |
| [agent-source.store.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-source.store.ts) | AgentSourceStoreError、AgentSourceStore |
| [agent-tool-source.store.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent-tool-source.store.ts) | readDocumentSource、AgentToolSourceStore |
| [agent.controller.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent.controller.ts) | AgentApiErrorFilter、AgentController |
| [agent.module.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent.module.ts) | AgentModule |
| [agent.service.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/agent.service.ts) | AgentService |
| [entity/agent-artifact-source.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-artifact-source.entity.ts) | AgentArtifactSource |
| [entity/agent-artifact-version.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-artifact-version.entity.ts) | AgentArtifactVersion |
| [entity/agent-artifact.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-artifact.entity.ts) | AgentArtifact |
| [entity/agent-document-save.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-document-save.entity.ts) | AgentDocumentSave |
| [entity/agent-message.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-message.entity.ts) | AgentMessage |
| [entity/agent-model-call.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-model-call.entity.ts) | AgentModelCall |
| [entity/agent-run-source.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-run-source.entity.ts) | AgentRunSource |
| [entity/agent-run.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-run.entity.ts) | AgentRun |
| [entity/agent-thread.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-thread.entity.ts) | AgentThread |
| [entity/agent-tool-attempt.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-tool-attempt.entity.ts) | AgentToolAttempt |
| [entity/agent-tool-call.entity.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/entity/agent-tool-call.entity.ts) | AgentToolCall |
| [tools/create-document.tool.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/create-document.tool.ts) | registerCreateDocumentTool |
| [tools/read-document.tool.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/read-document.tool.ts) | registerReadDocumentTool |
| [tools/tool-attempt.writer.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-attempt.writer.ts) | writeToolAttempt |
| [tools/tool-authorization.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-authorization.ts) | ToolAuthorization |
| [tools/tool-call-event.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-call-event.ts) | parseToolCallEventBody |
| [tools/tool-call-lifecycle.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-call-lifecycle.ts) | ToolCallTransitionError、createToolCallLifecycle、isToolCallTerminal、transitionToolCall |
| [tools/tool-call-preparer.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-call-preparer.ts) | ToolCallPreparer |
| [tools/tool-call.store.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-call.store.ts) | ToolCallStoreError、ToolCallStore |
| [tools/tool-catalog.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-catalog.ts) | ToolAssemblyError、ToolCatalog |
| [tools/tool-definition-validator.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-definition-validator.ts) | ToolRegistryError、assertToolDefinition |
| [tools/tool-definition.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-definition.ts) | 类型契约（无独立执行入口） |
| [tools/tool-execution-control.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-execution-control.ts) | ToolExecutionControl |
| [tools/tool-execution-maintenance.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-execution-maintenance.ts) | ToolExecutionMaintenance |
| [tools/tool-execution-registry.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-execution-registry.ts) | ToolExecutionRegistry |
| [tools/tool-executor.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-executor.ts) | ToolExecutor |
| [tools/tool-policy.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-policy.ts) | ToolPolicy |
| [tools/tool-resources.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-resources.ts) | bindingDigest、inspectToolResources |
| [tools/tool-retry.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-retry.ts) | ToolRetryPolicy、advanceDueRetry |
| [tools/tool-schema-validator.ts](D:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/agent/tools/tool-schema-validator.ts) | ToolSchemaCompileError、ToolSchemaValidator |

## 附录 B. 本轮交付范围与复核（2026-09-22）

本轮新增本文，校准以下 16 个核心文件的注释，未改变其执行语句：

- agent.service.ts：MCP 未实现边界、就绪哨兵、候选查询与串行调度、取消收尾。
- agent-run.reader.ts：非原子聚合查询、确认记录含已处理状态。
- agent-document-save.store.ts：保存摘要的真实字段、用户锁与 Run 锁取得位置。
- agent-conversation.store.ts：两种修订工作流、API 错误映射、事务 manager 组合。
- agent-checkpointer.ts：复用 TypeORM pool 的真实生命周期。
- agent-knowledge.service.ts：当前 Graph 初始化调用关系。
- agent-run.store.ts、agent-run.writer.ts：已接入业务链的职责边界。
- entity/agent-message.entity.ts：用户消息与助手回复实际关联方式。
- tools/create-document.tool.ts：启动时装配、用户选定版本后才创建调用。
- tools/tool-authorization.ts、tools/tool-call.store.ts：当前领取/保存/维护链调用关系。
- tools/tool-policy.ts、tools/tool-catalog.ts、tools/tool-schema-validator.ts、tools/tool-definition.ts：已实现的策略、装配及固定版本语义。

本轮重新执行：

| 检查 | 结果 |
|---|---|
| 全仓 pnpm typecheck | 29 个任务成功（28 个缓存命中） |
| server lint | 通过 |
| server test:unit（包含 nest build） | 228 项，221 通过、0 失败、7 跳过 |
| 全仓 pnpm lint | 失败；admin、editor-core 等未修改模块的既有错误，不通过关闭规则掩盖 |
| 文档源码链接 | 120 个文件/目录链接全部存在 |
| 完整集成再次复验 | 测试依赖端口拒绝连接，7 个顶层测试失败，未复验业务断言 |
| 测试服务恢复尝试 | Docker Desktop Linux Engine 管道不可用，无法启动 Compose |

此前同会话两轮 23/23 的真实通过记录仍保留在第 18 节，但不能冒充本轮环境不可用时的新通过。本文和注释交付已完成，最新数据库复验是明确的环境限制。未连接业务数据库、未执行真实模型调用、未提交或推送代码。

复核数据库测试时应先确认 Docker 引擎及三项测试服务 healthy，再在同一已构建工作区串行运行；不要为通过测试而放宽生产迁移、切换到业务库或绕过确认逻辑。
