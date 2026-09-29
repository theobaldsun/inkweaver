# Agent 模块阅读指南（按顺序）

面向第一次接手本模块的人。按"骨架 → 数据 → 主链路 → 工具 → 保存 → 外围 → 前端"的顺序读，
每一阶段结束都能回答一组具体问题，不需要回头补读。

标注含义：★必读（理解全模块的地基）　●按需（改动到相关功能时再看）　○外围

---

## 0. 读之前的四件事

1. **两条主线彼此独立**
   - Run 主线：一次用户请求 = 一个 Run，走 `CREATED → QUEUED → RUNNING → … → 终态`（`agent-run-lifecycle.ts`）。
   - ToolCall 主线：Run 内每次工具调用 = 一个逻辑调用，走 `PREPARED → READY → EXECUTING → … → 终态`（`tools/tool-call-lifecycle.ts`）。
   两套状态机**不要合并理解**，Run 结束不代表调用已结算，反之亦然。

2. **锁顺序固定**：先用户锁（`agent-data.cleanup.ts` 的 `lockAgentOwner`），再 Run 行锁。所有写入入口都遵守，避免死锁。

3. **事务边界**：本地数据库写入在事务内完成；**模型调用、向量检索、工具适配器一律在事务外**。适配器的结果/结算再开一个事务提交。

4. **三类不可信数据**：模型输出、工具结果、文档正文，都只当数据处理，不拼 SQL、不 `eval`、不当指令。

---

## 阶段一：骨架（约 30 分钟）

| 顺序 | 文件 | 行数 | 看什么 |
|---|---|---|---|
| ★1 | `apps/server/src/modules/agent/agent.module.ts` | 34 | 模块装配了哪些 provider、依赖哪些外部模块（Auth / Ai / Search）、注册了哪些实体 |
| ★2 | `agent.controller.ts` | 166 | 全部 HTTP 与 SSE 路由；`AgentApiErrorFilter` 如何把内部错误码映射成 400/409 |
| ★3 | `agent.service.ts` | 232 | 应用入口：`onModuleInit` 起的**唯一轮询** `tick()`，每 2s 一轮，负责索引投递、工具维护、领取 10 个 Run 并分派 |

读完应能回答：一条用户消息进来后，谁把它变成 Run？谁决定下一步执行什么？

关键分派逻辑在 `agent.service.ts:146-172`：
- `cancelRequested` → `settleCancellation()`（等无在途调用后落终态）
- `workflowVersion === 'agent-save-v1'` → `AgentSaveService.execute()`
- 其余 → `AgentGraphRunner.run()`

---

## 阶段二：数据模型与状态机（约 45 分钟）

### 2.1 实体（只看字段与可空性，不看逻辑）

`apps/server/src/modules/agent/entity/`

| 文件 | 行 | 说明 |
|---|---|---|
| ★`agent-run.entity.ts` | 83 | `agent_runs` 主表：`status / revision / executionPaused / cancelRequested / nextDispatchAt / toolCallLimit` |
| `agent-thread.entity.ts` | 27 | 会话容器 |
| `agent-message.entity.ts` | 38 | 只存用户可见内容；`requestKey + requestDigest` 是幂等基础 |
| ★`agent-tool-call.entity.ts` | 83 | 逻辑调用：`status / sideEffect / attemptCount / retryNotBefore / cancelRequested` |
| ★`agent-tool-attempt.entity.ts` | 43 | 每轮尝试：租约 `leaseOwner / leaseExpiresAt`、调用边界 `invocationStartedAt` |
| `agent-run-source.entity.ts` | 77 | Run 的来源快照与 `citationLabel` |
| `agent-artifact.entity.ts` / `agent-artifact-version.entity.ts` / `agent-artifact-source.entity.ts` | 22 / 56 / 26 | 成果头、版本、版本↔来源引用 |
| `agent-document-save.entity.ts` | 61 | 保存绑定：预留 `documentId`、`digest`、`status` |
| `agent-model-call.entity.ts` | 58 | 模型调用审计（不含提示词正文） |

### 2.2 迁移（按时间戳顺序，即真实演进顺序）

`apps/server/src/migrations/1789430400000-…` 起共 22 个，顺序本身就是设计史：

```
事件与运行 → 工具调用 → 尝试 → 确认 → 只读执行 → 崩溃恢复 → 重试调度
→ 会话消息 → Run 来源 → Checkpoint → 引用标签 → 模型审计 → 工具来源
→ 成果/修订区间/证据 → 文档保存/保存提交 → 模型预算 → 调度 → 存储与索引
```

读法：只扫 `up()` 的表结构与约束，**不要**跳过 CHECK 约束——很多业务规则（如"终态不得再变更"）落在数据库里。

### 2.3 两套状态机

| 顺序 | 文件 | 行 | 看什么 |
|---|---|---|---|
| ★4 | `agent-run-lifecycle.ts` | 66 | `transitionAgentRun()`：合法迁移表 + `isAgentRunTerminal()`；纯函数，不含 IO |
| ★5 | `tools/tool-call-lifecycle.ts` | 109 | `transitionToolCall()`：`RETRY_SCHEDULED / RETRY_DUE / OUTCOME_UNKNOWN / STOPPED_WITHOUT_EFFECT` 等事件的精确条件 |

读完应能回答：`sideEffect: 'unknown'` 为什么不能被取消清空？为什么 `OUTCOME_UNKNOWN` 不是终态？

---

## 阶段三：一次对话/任务的主链路（约 60 分钟）

按调用顺序读：

| 顺序 | 文件 | 行 | 职责 |
|---|---|---|---|
| ★6 | `agent-conversation.store.ts` | 227 | 用户消息 + 创建 Run + `RUN_CREATED` 事件**同事务**；`requestKey` 重放返回原记录 |
| ★7 | `agent-run.store.ts` | 112 | `agent_runs` 的内部读写入口，条件更新防并发 |
| ★8 | `agent-run.writer.ts` | 42 | 状态变更 + 事件序号 + 事件正文**全提交或全回滚** |
| ●9 | `agent-knowledge.service.ts` | 158 | 复用既有 RAG/混合检索选来源；候选最终仍按 `documents.userId + deletedAt` 复核 |
| ●10 | `agent-context.ts` | 195 | 上下文预算与裁剪、token 估算 |
| ●11 | `agent-model.config.ts` | 93 | 独立模型配置文件，密钥走环境变量 |
| ●12 | `agent-model.client.ts` | 220 | LangChain 适配器；`parseAgentModelDecision()` 解析工具调用 |
| ●13 | `agent-model-call.recorder.ts` | 72 | 调用审计：开始先提交 → 外部调用在事务外 → 结束记录 |
| ★14 | `agent-model-tools.ts` | 100 | 模型工具协议边界：只发布允许发现的定义，模型提出的调用不是许可 |
| ★15 | `agent-graph.ts` | 177 | LangGraph 编排：节点 `initialize / model / tools / generateOutline / publishOutline / draft / assembleSection / reviewEvidence / publishDraft / finish` |
| ★16 | `agent-graph.runner.ts` | 250 | 把业务端口（ports）接进 Graph：advisory lock、每次节点前 `guard()`、工具执行与来源捕获 |
| ○17 | `agent-checkpointer.ts` | 10 | PostgresSaver 适配，schema 固定 `agent_checkpoint`，禁止自动建表 |

`agent-graph.ts` 的读法：先看 `AgentGraphState`（第 16 行）与 `AgentGraphPorts`（第 33 行，全部业务能力都以端口注入），
再看第 169-175 行的边，最后逐个节点。Graph 只负责"执行位置 + 编排"，**业务写入全部在端口里的事务入口**。

---

## 阶段四：成果、引用与修订（约 30 分钟）

| 顺序 | 文件 | 行 | 职责 |
|---|---|---|---|
| ★18 | `agent-source.store.ts` | 117 | Run 来源快照持久化与去重 |
| ★19 | `agent-citations.ts` | 29 | `validateAgentCitations()`：回答里的 `[S1]` 必须落在本 Run 来源表内 |
| ●20 | `agent-evidence.ts` | 60 | 证据问题契约；解析模型 JSON，结构合法 ≠ 事实正确 |
| ★21 | `agent-artifact.store.ts` | 118 | 成果版本发布（用户锁 → Run 锁 → 版本递增） |
| ●22 | `agent-artifact-revision.ts` | 33 | 修订前复核归属、版本冲突、旧来源访问权 |
| ●23 | `agent-revision-range.ts` | 40 | 局部修订的半开区间替换（UTF-16 偏移） |
| ●24 | `agent-section-context.ts` | 62 | 章节修订：历史引用按原标签继承，新来源从其后编号 |
| ●25 | `agent-tool-source.store.ts` | 65 | 已提交的 `read_document` 结果转可引用来源 |

---

## 阶段五：工具链路（最硬核，约 90 分钟）

严格按下表顺序读，前面是后面的前置概念：

| 顺序 | 文件 | 行 | 职责 |
|---|---|---|---|
| ★26 | `tools/tool-definition.ts` | 45 | 工具描述契约（含未来 MCP 的 `origin`） |
| ★27 | `tools/tool-definition-validator.ts` | 60 | 结构校验与稳定错误码；只校验，不注册 |
| ★28 | `tools/tool-catalog.ts` 与 `tool-catalog.test.ts` | 152 | **唯一装配目录**：结构校验 → Schema 编译 → 适配器匹配，全成功才发布；定义与函数同表存储 |
| ★29 | `tools/tool-policy.ts` | 93 | 调用前策略判断：身份、允许列表、风险等级、MCP 连接、权限 |
| ★30 | `tools/tool-call-preparer.ts` | 94 | 串联策略 + 目录解析 + 输入 Schema 校验，产出 `prepared` |
| ●31 | `tools/tool-schema-validator.ts` | 87 | Ajv 实现的 JSON Schema 2020-12 校验，注册时一次编译 |
| ★32 | `tools/tool-resources.ts` | 69 | 资源归属检查与 `bindingDigest()`（确认绑定的摘要基础） |
| ★33 | `tools/tool-authorization.ts` | 187 | 授权与确认事务：`authorize / decide / expire / expireDue / recheck` |
| ★34 | `tools/tool-call.store.ts` | 152 | 逻辑调用持久化与条件迁移；`transition()` 是状态落库的唯一入口 |
| ●35 | `tools/tool-attempt.writer.ts` | 43 | 尝试记录写入，仅由 ToolCallStore 调用 |
| ★36 | `tools/tool-executor.ts` | 277 | 受控只读执行：**领取事务（授权+预算+租约）→ 适配器在事务外 → 结算事务（结果+预算+迁移）** |
| ★37 | `tools/tool-retry.ts` | 112 | 与恢复侧共用的退避策略 `ToolRetryPolicy` 与 `advanceDueRetry()` |
| ★38 | `tools/tool-execution-registry.ts` | 45 | 进程内取消桥接（AbortController）；数据库 `cancelRequested` 才是持久事实 |
| ★39 | `tools/tool-execution-control.ts` | 175 | 取消、过期只读租约恢复、到期重试推进 |
| ★40 | `tools/tool-execution-maintenance.ts` | 50 | 单轮维护；**轮询由 `AgentService.tick()` 驱动**，本类不带定时器 |
| ●41 | `tools/read-document.tool.ts` | 30 | 唯一的真实只读工具：按归属读取并比对正文/位置版本 |
| ●42 | `tools/create-document.tool.ts` | 23 | 保存工具定义；真正写入在 `agent-document.writer.ts` |

读完应能回答：一次 `read_document` 从模型提议到结果入库，经过几道闸门？租约过期后谁接手？退避到期由谁推回 `READY`？

---

## 阶段六：保存链路（写路径，约 30 分钟）

| 顺序 | 文件 | 行 | 职责 |
|---|---|---|---|
| ★43 | `agent-save.service.ts` | 76 | `prepare()` 建 Run + 预留保存 + 请求确认；`execute()` 批准后原子提交 |
| ★44 | `agent-document-save.store.ts` | 119 | `prepare()` = 复核 + 预留文档 ID；`verify()` = 执行阶段**只读复核**（不写、不开事务） |
| ★45 | `agent-document.writer.ts` 与 `agent-document.writer.test.ts` | 103 | 文档创建 + Yjs 快照 + 同步记录 + 保存事实 + 调用结果 + 预算**同事务** |

读法重点：为什么 `verify()` 与 `prepare()` 要分开？（避免嵌套事务与重复预留）
为什么 `insert` 而不是 `upsert`？（预留 ID 被占用时不能覆盖既有文档）

---

## 阶段七：事件、查询、调度与外围（约 25 分钟）

| 顺序 | 文件 | 行 | 职责 |
|---|---|---|---|
| ★46 | `agent-event.ts` | 92 | 持久化事件正文的解析与校验（区分于驱动状态迁移的领域事件） |
| ●47 | `agent-event.writer.ts` | 22 | 事务内事件写入，不独立提交 |
| ●48 | `agent-event.reader.ts` | 57 | 事件分页；SSE 断线补齐靠它 |
| ●49 | `agent-run.reader.ts` | 113 | 只读查询层：会话列表/明细、运行快照；行类型从实体投影 |
| ○50 | `agent-data.cleanup.ts` | 43 | `lockAgentOwner()`（用户锁）与账号清理；未结束 Run 阻止清理 |
| ○51 | `agent-data.exporter.ts` | 145 | 用户数据导出 |

---

## 阶段八：前端与 API 契约（约 20 分钟）

| 顺序 | 文件 | 行 | 职责 |
|---|---|---|---|
| ●52 | `packages/api/src/agent/agentApi.ts` | 126 | 前端唯一入口；类型与后端快照一一对应 |
| ●53 | `apps/web/src/pages/AgentPage.tsx` | 222 | 工作台界面：会话/运行选择、成果渲染、引用链接、确认与保存交互 |
| ○54 | `apps/web/src/styles/agent.css` | 29 | 样式 |

`AgentPage.tsx` 里两个值得先看的函数：`citedText()`（把 `[S1]` 渲染成来源链接，不用 `dangerouslySetInnerHTML`）与提交时的请求键复用逻辑（防重复操作）。

---

## 阶段九：测试地图（按需对照）

| 想验证什么 | 看哪个测试 |
|---|---|
| 状态机规则 | `agent-run-lifecycle.test.ts`、`tools/tool-call-lifecycle.test.ts` |
| 工具装配/策略 | `tools/tool-catalog.test.ts`、`tool-definition-validator.test.ts`、`tool-policy.test.ts` |
| 重试与到期推进 | `tools/tool-retry.test.ts`（离线）、`tools/tool-call.persistence.integration.test.ts`（真实事务竞争） |
| 保存完整链路 | `agent-v1.persistence.integration.test.ts` |
| 会话与 Run 持久化 | `agent-conversation.persistence.integration.test.ts`、`agent-runs.integration.test.ts` |
| 上下文/引用/证据/修订 | `agent-context.test.ts`、`agent-citations.test.ts`、`agent-evidence.test.ts`、`agent-revision-range.test.ts`、`agent-section-context.test.ts` |

集成测试统一开关：`RUN_INTEGRATION_TESTS=1`（`apps/server/scripts/run-integration-tests.mjs` 自动设置），
前置 `docker compose -f docker-compose.test.yml up -d`。

---

## 速查：常见问题从哪个文件入手

| 问题 | 入口 |
|---|---|
| 用户消息怎么变成一次运行？ | `agent-conversation.store.ts` → `agent.service.ts:submit()` |
| 为什么 Run 卡在等待确认？ | `tools/tool-authorization.ts`（`authorize / decide / expire`） |
| 工具为什么没执行/一直重试？ | `tools/tool-executor.ts` → `tool-retry.ts` → `tool-execution-control.ts` |
| 进程崩了，在途调用谁收尾？ | `tool-execution-control.ts:recoverExpired()`、维护单轮 `tool-execution-maintenance.ts` |
| 取消为什么不是立刻生效？ | `tool-execution-registry.ts`（本进程信号）+ 数据库 `cancelRequested`（持久事实） |
| 保存为什么需要二次确认？ | `agent-save.service.ts` → `agent-document.writer.ts` |
| 引用 `[S1]` 怎么变成链接？ | 后端 `agent-citations.ts` → 前端 `AgentPage.tsx:citedText()` |
| 想加一个新工具 | `tool-definition.ts` → 在 `agent.service.ts:assembleV1Tools()` 装配 → 适配器实现 |

---

## 阅读时的 5 条提醒

1. **授权结果不可缓存**：`ToolPolicy.evaluate()` 与 `ToolAuthorization.recheck()` 都是即时判断，策略/目录变更必须立刻生效。
2. **目录撤销不收回已取得的函数引用**：执行前必须重新 `resolve()` 并比对，见 `tool-executor.ts` 的 `TOOL_REPLACED`。
3. **适配器只接受 JSON 边界**：参数与结果都经 `structuredClone`/JSON 序列化，不传函数或类实例。
4. **v1 只装配内置工具**：`AgentService.assembleV1Tools()` 装配后校验 origin 必须 `builtin`；MCP 的类型与策略接口保留，但暂不接入核心路径。
5. **不要为了省事合并**：生命周期模型、事务边界、实体、迁移、测试各自独立是有意为之，机械合并会破坏可回滚性。
