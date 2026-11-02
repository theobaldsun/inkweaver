/** Agent 应用入口与持久化调度；复用业务事实、Graph 和确认写入，不在启动时迁移数据库或探测供应商。 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createAgentCheckpointer } from './agent-checkpointer';
import { AgentConversationStore } from './agent-conversation.store';
import { lockAgentOwner } from './agent-data.cleanup';
import { AgentGraphRunner, agentCheckpointKey } from './agent-graph.runner';
import { AgentKnowledgeService } from './agent-knowledge.service';
import { AgentModelClient } from './agent-model.client';
import { isAgentRunTerminal } from './agent-run-lifecycle';
import { AgentRunWriter } from './agent-run.writer';
import { AgentSaveService } from './agent-save.service';
import { AgentRun } from './entity/agent-run.entity';
import { registerCreateDocumentTool } from './tools/create-document.tool';
import { registerReadDocumentTool } from './tools/read-document.tool';
import { ToolAuthorization } from './tools/tool-authorization';
import { ToolCatalog } from './tools/tool-catalog';
import { ToolExecutionControl } from './tools/tool-execution-control';
import { ToolExecutionMaintenance } from './tools/tool-execution-maintenance';
import { DocumentIndexService } from '../ai/document-index.service';

import type { CreateAgentRequest } from './agent-conversation.store';
import type { PrepareAgentDocumentSave } from './agent-document-save.store';
import type { ToolAuthorizationContext } from './tools/tool-authorization';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * v1 核心路径的唯一工具装配入口：只装配内置适配器。
 * MCP 与外部工具暂不进入核心路径——目前没有连接注册、凭据托管和用户审批流程，
 * 但 ToolOrigin.mcp、ToolPolicy.allowedMcpConnections 与目录的适配器匹配校验都保留，
 * 这不代表 MCP 已可执行；接入仍须扩展 Graph/Executor 的 builtin 限制及安全恢复策略。
 * @param catalog 进程内共享目录；装配失败不会留下半成品工具。
 * @param manager 真实文档工具需要的非事务 manager。
 */
function assembleV1Tools(catalog: ToolCatalog, manager: EntityManager): void {
  registerReadDocumentTool(catalog, manager);
  registerCreateDocumentTool(catalog);
  // 装配后统一复核来源：任何非内置工具都不能悄悄进入 v1 核心路径。
  if (catalog.list().some((tool) => tool.origin.kind !== 'builtin')) throw new Error('AGENT_TOOL_ORIGIN_UNSUPPORTED');
}

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  /** 工具目录仅由服务端可信启动代码装配。 */
  readonly catalog = new ToolCatalog();
  /** 单进程轮询句柄，不承担持久化职责。 */
  private timer?: ReturnType<typeof setTimeout>;
  /** 停止接收新轮次。 */
  private stopping = false;
  /** 本进程已开始的轮询，用于退出时等待连接归还。 */
  private pending?: Promise<void>;
  /** Graph 延迟创建，未迁移环境不影响其他现有模块启动。 */
  private runner?: AgentGraphRunner;
  /** 只记录稳定内部信息，不打印用户目标或供应商响应。 */
  private readonly logger = new Logger(AgentService.name);

  constructor(readonly dataSource: DataSource, readonly model: AgentModelClient, private readonly knowledge: AgentKnowledgeService, private readonly index: DocumentIndexService) {
    assembleV1Tools(this.catalog, dataSource.manager);
  }

  /** 启动无重入维护循环；关闭模型时不执行 Graph，也不触发知识检索。 */
  onModuleInit(): void {
    const loop = () => {
      if (this.stopping) return;
      this.pending = this.tick().catch(() => { this.logger.warn('AGENT_DISPATCH_UNAVAILABLE'); }).finally(() => {
        if (!this.stopping) { this.timer = setTimeout(loop, 2000); this.timer.unref(); }
      });
    };
    this.timer = setTimeout(loop, 2000);
    this.timer.unref();
  }

  /** 等待当前短事务/模型超时收尾；不销毁 TypeORM 所持连接池。 */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
  }

  /** 不访问模型网络的就绪查询；仅检查两个末端迁移哨兵列，不是全量 schema 完整性验证。 */
  async status() {
    // 两个 EXISTS 取 AND：只有当 agent_runs.nextDispatchAt 与 agent_document_saves.indexScheduledAt
    // 这两列（由不同迁移分别加入）都存在，才认为"已迁移到支持调度的版本"。
    // 故意只查 information_schema 而非碰业务表——未迁移环境也能安全返回 ready:false 而不报错。
    const [row] = await this.dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='agent_runs' AND column_name='nextDispatchAt') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='agent_document_saves' AND column_name='indexScheduledAt') AS ready`);
    // ready 是布尔列；模型侧三项均不读网络，仅回显配置状态供前端/健康检查判断，故 status 接口永不因模型关闭而 5xx。
    return { ready: row?.ready === true, modelConfigured: this.model.isConfigured(), model: this.model.configuredModel(), limits: this.model.limits() };
  }

  /** 首版只开放本人资料库和内置工具；每一步仍检查资源当前归属和删除状态。 */
  context(userId: string, save = false): ToolAuthorizationContext {
    // save=true 是"准备保存"路径：额外解锁 L1 写工具 create_document；save=false（默认）是只读/执行路径：仅 L0 读工具 read_document。
    // 权限与工具白名单会由 ToolAuthorization 在每次工具调用时再核一遍（纵深防御，不依赖此处一次性构造）。
    return { policy: { principal: { userId, permissions: ['documents:read', 'documents:create'] },
      allowedTools: save ? ['create_document'] : ['read_document'], allowedRiskLevels: save ? ['L0', 'L1'] : ['L0'] },
    scope: { allowOwnedLibrary: true, documentIds: [], folderIds: [] } };
  }

  /** 创建消息和任务、发布调度意图同事务，重放请求不会解除已有错误暂停。 */
  async submit(userId: string, input: Omit<CreateAgentRequest, 'workflowVersion'>) {
    // 提交必然要走 Graph（模型推理），故此处硬性要求模型就绪；与 resume/save-v1 允许模型关闭形成对照——
    // 那两条是崩溃恢复/纯本地保存，不碰模型。
    if (!this.model.isConfigured()) throw new ServiceUnavailableException('Agent 模型调用已关闭或尚未配置');
    // 工作流版本按"最具体意图优先"四级链选取：章节修订 > 全文修订 > 任务 > 只读。
    // 用 else-if 链而非并列 if：保证任一 input 只命中一个版本，避免后续分支歧义。
    // 类型用 CreateAgentRequest['workflowVersion'] 索引访问，保持与落库结构一致的字面量联合，不退化成 string。
    let workflowVersion: CreateAgentRequest['workflowVersion'];
    if (input.revisionTarget?.range) workflowVersion = 'agent-section-v1';
    else if (input.revisionTarget) workflowVersion = 'agent-revise-v1';
    else if (input.mode === 'task') workflowVersion = 'agent-task-v2';
    else workflowVersion = 'agent-read-v1';
    // 同事务内：先写用户消息、再建 Run，二者原子——半途崩溃不会出现"有消息无 Run"。
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const record = await new AgentConversationStore(manager).appendUserMessageAndCreateRun(userId, { ...input, workflowVersion });
      // replayed=true 表示幂等去重命中（同一请求已提交过）：不重复 unpause，保持原 Run 的暂停/错误态。
      // 仅全新提交才清 executionPaused，让 tick 立刻能捞起这个新 Run。
      if (!record.replayed) await manager.query('UPDATE agent_runs SET "executionPaused"=false WHERE id=$1 AND "userId"=$2', [record.run.id, userId]);
      return record;
    });
  }

  /** 用户看到完整草稿后显式准备保存；仍须下一步确认，不调用模型。 */
  async prepareSave(userId: string, threadId: string, input: PrepareAgentDocumentSave) {
    // 用非事务 manager：prepare 内部自行管理事务边界（预留 documentId、登记待确认）。
    // 直接 new AgentSaveService 而非 DI，是因为它无状态、每请求一例即可，无需容器托管。
    return new AgentSaveService(this.dataSource.manager, this.catalog).prepare(userId, threadId, input, this.context(userId, true));
  }

  /** 只恢复同一任务检查点和保存绑定，不克隆任务或重置预算。 */
  async resume(userId: string, runId: string): Promise<void> {
    await this.dataSource.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await manager.getRepository(AgentRun).findOneByOrFail({ id: runId, userId });
      // 终态或已请求取消的 Run 不可恢复——防止把已结束/正在取消的任务重新投入执行。
      if (isAgentRunTerminal(run.status) || run.cancelRequested) throw new Error('AGENT_RUN_NOT_RESUMABLE');
      // 非 save-v1 的恢复需要模型（要重新跑 Graph）；save-v1 是纯本地保存，模型关闭也能恢复（崩溃恢复路径）。
      if (run.workflowVersion !== 'agent-save-v1' && !this.model.isConfigured()) throw new Error('AGENT_MODEL_NOT_CONFIGURED');
      // 清 executionPaused + 清历史错误码 + nextDispatchAt 置现在：立即重新进入可派发集合，下轮 tick 捞起。
      await manager.query(`UPDATE agent_runs SET "executionPaused"=false,"lastErrorCode"=NULL,"nextDispatchAt"=clock_timestamp()
        WHERE id=$1 AND "userId"=$2`, [runId, userId]);
    });
  }

  /** 保存确认由既有参数和资源摘要裁决；拒绝发出持久化取消意图。 */
  async decide(userId: string, runId: string, callId: string, confirmationId: string, accept: boolean) {
    // 真正的确认裁决（比对 confirmationId、资源摘要、权限）交给 ToolAuthorization；本方法只做"接受/拒绝"后的副作用路由。
    const result = await new ToolAuthorization(this.dataSource.manager, this.catalog).decide(userId, runId, callId, confirmationId, accept, this.context(userId, true));
    // 接受 → 恢复执行（下一步由 tick 跑 save-v1 落地）；拒绝 → 取消整个 Run。
    if (result.status === 'APPROVED') await this.resume(userId, runId);
    else await this.cancel(userId, runId);
    return result;
  }

  /** 取消请求先持久化，再通知工具；Worker 持有执行锁并确认无在途调用后落终态。 */
  async cancel(userId: string, runId: string): Promise<void> {
    // 阶段一（事务内）：持久化取消意图 + 解锁暂停，让 tick 的 settleCancellation 分支能捞起并终态化。
    await this.dataSource.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await manager.getRepository(AgentRun).findOneByOrFail({ id: runId, userId });
      if (isAgentRunTerminal(run.status)) return; // 已终态则无需动作（幂等）。
      // cancelRequested=true + executionPaused=false：即便模型关闭，tick 的 cancelRequested 分支也能结算（见 tick 候选查询）。
      await manager.query(`UPDATE agent_runs SET "cancelRequested"=true,"executionPaused"=false,"nextDispatchAt"=clock_timestamp()
        WHERE id=$1 AND "userId"=$2`, [runId, userId]);
    });
    // 阶段二（事务外）：逐条通知在途工具调用取消（释放租约/标记 CANCELLED）。放在事务外——避免长事务持锁，
    // 且工具取消可能含外部副作用，其失败不影响"意图已持久化"这一关键不变量。
    const calls: Array<{ id: string }> = await this.dataSource.query('SELECT id FROM agent_tool_calls WHERE "runId"=$1 AND "userId"=$2', [runId, userId]);
    for (const call of calls) await new ToolExecutionControl(this.dataSource.manager).cancel(userId, runId, call.id);
  }

  /**
   * 本进程唯一的 Agent 轮询入口：工具执行维护（过期租约、退避到期、确认到期）与
   * 运行调度共用一个循环，维护侧不再自带定时器，避免出现两套节奏。
   * 供隔离测试和应用生命周期复用。
   *
   * 每轮固定顺序：索引兜底 → 工具维护 → 取候选 → 逐个裁决派发。
   * 每轮最多查询 10 个候选并依次处理，查询本身不是领取——
   * 跨实例裁决靠 Graph 会话锁或保存事务中的用户锁/幂等绑定，慢调用只推迟同批后续候选。
   */
  async tick(): Promise<void> {
    // 模型关闭是整体降级开关：本轮连索引调度也一并跳过，避免"Agent 已停用"仍有后台写副作用。
    if (this.model.isConfigured()) await this.dispatchIndexing();
    // 维护必须先于派发：崩溃残留的过期租约要释放工具槽位，退避/确认到期要让候选在本轮就变为可派发。
    await new ToolExecutionMaintenance(this.dataSource.manager, this.catalog).runOnce();
    // 查询≠领取（无 FOR UPDATE、不改任何状态）；可派发由 nextDispatchAt 退避时间戳裁决，
    // 每轮 10 条上限保证单个慢 Run 只阻塞同批后续候选，下一轮 2s 后自然续上。
    // 模型关闭时只保留不依赖模型的两类：保存执行与取消结算。
    const runs: AgentRun[] = await this.dataSource.query(`SELECT * FROM agent_runs WHERE "executionPaused"=false
      AND status IN ('CREATED','QUEUED','RUNNING','WAITING_CONFIRMATION') AND "nextDispatchAt"<=clock_timestamp()
      AND ($1::boolean OR "workflowVersion"='agent-save-v1' OR "cancelRequested"=true)
      ORDER BY "nextDispatchAt",id LIMIT 10`, [this.model.isConfigured()]);
    for (const run of runs) {
      // 收到停止信号就不再开启新候选；上一轮 await 的收尾在其返回后的下一个边界退出。
      if (this.stopping) return;
      try {
        // 取消优先：即便 Run 已进入执行，用户按下取消后也先走结算路径，不等 Graph 自然跑完。
        if (run.cancelRequested) await this.settleCancellation(run);
        // 保存执行是纯本地事务、不碰模型，模型关闭时也必须能走完（重放提交后的崩溃恢复）。
        else if (run.workflowVersion === 'agent-save-v1') await new AgentSaveService(this.dataSource.manager, this.catalog).execute(run.userId, run.id, this.context(run.userId, true));
        else {
          if (!this.runner) {
            // 仅首个 Graph Run 付一次 checkpointer 初始化成本；模型关闭时永远到不了这里，不会建多余连接。
            // 使用 TypeORM 已配置的同库连接池，避免第二套地址或意外连接业务外数据库。
            const pool = (this.dataSource.driver as unknown as { master: Parameters<typeof createAgentCheckpointer>[0] }).master;
            this.runner = new AgentGraphRunner({ dataSource: this.dataSource, catalog: this.catalog, knowledge: this.knowledge,
              model: this.model, checkpointer: await createAgentCheckpointer(pool), authorization: async (userId) => this.context(userId) });
          }
          // Run 级 pg 咨询锁由 runner 持有：BUSY 说明别的实例正在跑同一 Run，本实例直接跳过不抢。
          await this.runner.run(run.userId, run.id);
        }
        // 仅成功路径执行（失败走 catch 打 paused 出局，到不了这里）：对终态行是无害空转——
        // 它们已被 status IN (...) 挡在候选集外；真正消费它的是非终态的成功返回
        // （等确认 WAITING_CONFIRMATION、取消未结算），借此获得"每轮最多重检一次"的节流，
        // 数值与 onModuleInit 的 2s 轮询节奏对齐。BUSY 走下面的 continue 不动这一行，尽快重试。
        await this.dataSource.query('UPDATE agent_runs SET "nextDispatchAt"=clock_timestamp()+interval \'2 seconds\' WHERE id=$1 AND "userId"=$2', [run.id, run.userId]);
      } catch (error) {
        // BUSY 不是本 Run 的失败：不写错误码、不翻 executionPaused，保持原样等下一轮即可。
        if (error instanceof Error && error.message === 'AGENT_GRAPH_BUSY') continue;
        // Error.message 只是偶发契约：形如稳定错误码（大写字母/数字/下划线，2-64 字符）才落库，其余归一，防止任意文本进数据库。
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'AGENT_EXECUTION_FAILED';
        // 取消优先于错误暂停：模型返回的取消错误不应把取消请求永久搁置在暂停态。
        // NOT IN 终态守卫：失败回调可能与正常收尾竞态，不能把已完成/已取消的 Run 拉回暂停。
        await this.dataSource.query(`UPDATE agent_runs SET "executionPaused"=NOT "cancelRequested","lastErrorCode"=$3
          WHERE id=$1 AND "userId"=$2 AND status NOT IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT')`, [run.id, run.userId, code]);
      }
    }
  }

  /**
   * 已保存文档的索引兜底投递：保存事务只落行，入队由本方法在轮询中补，
   * "事务已提交、BullMQ 未入队"之间崩溃也不会丢索引——表即持久队列。
   * indexScheduledAt 是"已投递"标记而非"已索引完成"；投递失败的行继续挂 NULL，下轮自动重扫，无需退避计数。
   * 与 tick() 主查询同一模型：查询≠领取，多实例并发投递靠 BullMQ 固定 jobId 去重兜底。
   */
  private async dispatchIndexing(): Promise<void> {
    // LEFT JOIN 而非 INNER：文档可能已被硬删，保存行仍需被扫到才能打上"已投递"，否则永远 NULL 每轮重查。
    // JOIN 条件带 userId 是租户隔离：同 UUID 跨用户也绝不误 join。
    // 只扫 SAVED：PREPARED 仅预留 documentId、文档尚不存在，没有可索引的内容。
    // savedAt 定序 + id 做稳定 tiebreak：同事务时钟可能并列，顺序必须确定。
    // LIMIT 10：scheduleReindex 是 Redis 往返，封顶避免拖慢 2s 轮询节奏；扫不完的下轮继续。
    const rows: Array<{ id: string; documentId: string; userId: string; title: string; content: string; deletedAt: Date | null }> =
      await this.dataSource.query(`SELECT s.id,s."documentId",s."userId",d.title,d.content,d."deletedAt" FROM agent_document_saves s
        LEFT JOIN documents d ON d.id=s."documentId" AND d."userId"=s."userId"
        WHERE s.status='SAVED' AND s."indexScheduledAt" IS NULL ORDER BY s."savedAt",s.id LIMIT 10`);
    for (const row of rows) {
      // 三种"可收尾"走向与一种"留待重试"：
      // !row.title —— 文档已硬删，无正文可索引，直接标记，避免无限重查；
      // row.deletedAt —— 软删在回收站，不重建索引；文档恢复时 documents.service 会自行触发重索引；
      // scheduleReindex()=true —— 入队成功（或被合并为 30s 延迟任务），标记。
      // 返回 false —— BullMQ 暂不可用（队列内部已记 warn）：不标记，本行继续挂 NULL 等下轮。
      // 两个内存判断前置短路，避免拿空内容去打 Redis；调度只读当前内容，不用保存时的过期快照。
      if (!row.title || row.deletedAt || await this.index.scheduleReindex({ docId: row.documentId, userId: row.userId, title: row.title, content: row.content })) {
        // 语义是"至少投递过一次"，不是"已并入索引"：任务失败重试归 BullMQ（attempts:3+指数退避）管，表这层不回滚。
        // 多实例同时扫到同一 NULL 行时，固定 jobId reindex-${docId} 让重复入队天然去重，重复 UPDATE 亦幂等。
        await this.dataSource.query('UPDATE agent_document_saves SET "indexScheduledAt"=clock_timestamp() WHERE id=$1 AND "userId"=$2', [row.id, row.userId]);
      }
    }
  }

  /**
   * 取消结算：把"用户已请求取消"的 Run 在安全时点落成 CANCELLED 终态。
   *
   * 三重守卫，任一不过就原地返回（不推 nextDispatchAt，下轮 tick 自然重试）：
   * 1. 抢不到 Graph 会话锁——该 Run 正在别处执行，不归本实例结算；
   * 2. 事务内重读发现已终态——SELECT 之后已被其他路径（如另一实例）结算；
   * 3. 尚存非终态工具调用——工具可能正在写库（如 create_document 提交中），取消会把它撂半路。
   *
   * 取消只结清意图、不做补偿：已保存的文档不回滚。
   * 会话锁必须用独立 QueryRunner 持有：Postgres 咨询锁是会话级的，
   * 池化的 manager 每次查询可能落到不同连接，unlock 会找错会话静默失效、锁泄漏到连接销毁为止。
   */
  private async settleCancellation(run: AgentRun): Promise<void> {
    // 专用 QueryRunner：为咨询锁钉住一条物理连接，在本方法内 connect/release 成对开闭。
    const lock = this.dataSource.createQueryRunner();
    await lock.connect();
    // 与 Graph 执行共用同一把锁（key 生成函数就出自 runner 模块）：正在跑的 Run 抢不到锁，天然互斥。
    const key = agentCheckpointKey(run.userId, run.id);
    let acquired = false;
    try {
      // pg_try_ 前缀 = 非阻塞：抢不到立刻返回 false，绝不等待——tick 是共享循环，
      // 不能因一个忙碌的 Run 把同批 10 个候选全堵死。hashtextextended 把字符串键映射成 bigint 锁 ID。
      [ { acquired } ] = await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [key]);
      if (!acquired) return;
      await this.dataSource.transaction('READ COMMITTED', async (manager) => {
        // 用户行锁（users FOR UPDATE）：同一用户的 Agent 写事务排队，与 AgentRunWriter 同一纪律；
        // 顺带校验用户仍在——行没了直接 AGENT_OWNER_UNAVAILABLE，不给已删用户落状态。
        await lockAgentOwner(manager, run.userId);
        // 重读而非信入参 run：那是几秒前 SELECT 的快照，期间状态可能已被其他路径改写。
        const current = await manager.getRepository(AgentRun).findOneByOrFail({ id: run.id, userId: run.userId });
        if (isAgentRunTerminal(current.status)) return;
        // 在途工具调用（未成功/失败/取消/过期）= 可能正在写库，此刻取消会把它撂半路；LIMIT 1 只查存在性。
        const active = await manager.query(`SELECT id FROM agent_tool_calls WHERE "runId"=$1 AND "userId"=$2
          AND status NOT IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') LIMIT 1`, [run.id, run.userId]);
        if (active.length) return;
        // 走 Writer 而非裸 UPDATE：取消是生命周期迁移，状态与事件必须同事务原子落库（CAS + 事件流）。
        await new AgentRunWriter(manager).transition(run.userId, run.id, current, { type: 'CANCEL_SETTLED' });
      });
    } finally {
      // 嵌套 finally：unlock 自身抛错（如连接已断）也必须 release，否则 QueryRunner 连接泄漏。
      // 顺序不可换：先解锁再释放连接；acquired 为假（含 connect 失败路径）时无需解锁。
      try { if (acquired) await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); }
      finally { await lock.release(); }
    }
  }
}
