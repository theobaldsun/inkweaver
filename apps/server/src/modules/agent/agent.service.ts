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
    const [row] = await this.dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='agent_runs' AND column_name='nextDispatchAt') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='agent_document_saves' AND column_name='indexScheduledAt') AS ready`);
    return { ready: row?.ready === true, modelConfigured: this.model.isConfigured(), model: this.model.configuredModel(), limits: this.model.limits() };
  }

  /** Agent API 先检查迁移哨兵列；不自动建表，也不替代实际迁移和集成验收。 */
  async ensureReady(): Promise<void> {
    if (!(await this.status()).ready) throw new ServiceUnavailableException('Agent 数据结构尚未迁移');
  }

  /** 首版只开放本人资料库和内置工具；每一步仍检查资源当前归属和删除状态。 */
  context(userId: string, save = false): ToolAuthorizationContext {
    return { policy: { principal: { userId, permissions: ['documents:read', 'documents:create'] },
      allowedTools: save ? ['create_document'] : ['read_document'], allowedRiskLevels: save ? ['L0', 'L1'] : ['L0'] },
    scope: { allowOwnedLibrary: true, documentIds: [], folderIds: [] } };
  }

  /** 创建消息和任务、发布调度意图同事务，重放请求不会解除已有错误暂停。 */
  async submit(userId: string, input: Omit<CreateAgentRequest, 'workflowVersion'>) {
    await this.ensureReady();
    if (!this.model.isConfigured()) throw new ServiceUnavailableException('Agent 模型调用已关闭或尚未配置');
    const workflowVersion = input.revisionTarget?.range ? 'agent-section-v1' : input.revisionTarget ? 'agent-revise-v1'
      : input.mode === 'task' ? 'agent-task-v2' : 'agent-read-v1';
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const record = await new AgentConversationStore(manager).appendUserMessageAndCreateRun(userId, { ...input, workflowVersion });
      if (!record.replayed) await manager.query('UPDATE agent_runs SET "executionPaused"=false WHERE id=$1 AND "userId"=$2', [record.run.id, userId]);
      return record;
    });
  }

  /** 用户看到完整草稿后显式准备保存；仍须下一步确认，不调用模型。 */
  async prepareSave(userId: string, threadId: string, input: PrepareAgentDocumentSave) {
    await this.ensureReady();
    return new AgentSaveService(this.dataSource.manager, this.catalog).prepare(userId, threadId, input, this.context(userId, true));
  }

  /** 只恢复同一任务检查点和保存绑定，不克隆任务或重置预算。 */
  async resume(userId: string, runId: string): Promise<void> {
    await this.ensureReady();
    await this.dataSource.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await manager.getRepository(AgentRun).findOneByOrFail({ id: runId, userId });
      if (isAgentRunTerminal(run.status) || run.cancelRequested) throw new Error('AGENT_RUN_NOT_RESUMABLE');
      if (run.workflowVersion !== 'agent-save-v1' && !this.model.isConfigured()) throw new Error('AGENT_MODEL_NOT_CONFIGURED');
      await manager.query(`UPDATE agent_runs SET "executionPaused"=false,"lastErrorCode"=NULL,"nextDispatchAt"=clock_timestamp()
        WHERE id=$1 AND "userId"=$2`, [runId, userId]);
    });
  }

  /** 保存确认由既有参数和资源摘要裁决；拒绝发出持久化取消意图。 */
  async decide(userId: string, runId: string, callId: string, confirmationId: string, accept: boolean) {
    await this.ensureReady();
    const result = await new ToolAuthorization(this.dataSource.manager, this.catalog).decide(userId, runId, callId, confirmationId, accept, this.context(userId, true));
    if (result.status === 'APPROVED') await this.resume(userId, runId);
    else await this.cancel(userId, runId);
    return result;
  }

  /** 取消请求先持久化，再通知工具；Worker 持有执行锁并确认无在途调用后落终态。 */
  async cancel(userId: string, runId: string): Promise<void> {
    await this.ensureReady();
    await this.dataSource.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await manager.getRepository(AgentRun).findOneByOrFail({ id: runId, userId });
      if (isAgentRunTerminal(run.status)) return;
      await manager.query(`UPDATE agent_runs SET "cancelRequested"=true,"executionPaused"=false,"nextDispatchAt"=clock_timestamp()
        WHERE id=$1 AND "userId"=$2`, [runId, userId]);
    });
    const calls: Array<{ id: string }> = await this.dataSource.query('SELECT id FROM agent_tool_calls WHERE "runId"=$1 AND "userId"=$2', [runId, userId]);
    for (const call of calls) await new ToolExecutionControl(this.dataSource.manager).cancel(userId, runId, call.id);
  }

  /**
   * 供隔离测试和应用生命周期复用；每轮最多查询 10 个候选并依次处理，查询本身不是领取。
   * Graph 会话锁及保存事务中的用户锁/幂等绑定负责跨实例裁决；慢调用会推迟后续候选。
   * 本进程唯一的 Agent 轮询入口：工具执行维护（过期租约、退避到期、确认到期）与
   * 运行调度共用一个循环，维护侧不再自带定时器，避免出现两套节奏。
   */
  async tick(): Promise<void> {
    if (!(await this.status()).ready) return;
    if (this.model.isConfigured()) await this.dispatchIndexing();
    await new ToolExecutionMaintenance(this.dataSource.manager, this.catalog).runOnce();
    const runs: AgentRun[] = await this.dataSource.query(`SELECT * FROM agent_runs WHERE "executionPaused"=false
      AND status IN ('CREATED','QUEUED','RUNNING','WAITING_CONFIRMATION') AND "nextDispatchAt"<=clock_timestamp()
      AND ($1::boolean OR "workflowVersion"='agent-save-v1' OR "cancelRequested"=true)
      ORDER BY "nextDispatchAt",id LIMIT 10`, [this.model.isConfigured()]);
    for (const run of runs) {
      if (this.stopping) return;
      try {
        if (run.cancelRequested) await this.settleCancellation(run);
        else if (run.workflowVersion === 'agent-save-v1') await new AgentSaveService(this.dataSource.manager, this.catalog).execute(run.userId, run.id, this.context(run.userId, true));
        else {
          if (!this.runner) {
            // 使用 TypeORM 已配置的同库连接池，避免第二套地址或意外连接业务外数据库。
            const pool = (this.dataSource.driver as unknown as { master: Parameters<typeof createAgentCheckpointer>[0] }).master;
            this.runner = new AgentGraphRunner({ dataSource: this.dataSource, catalog: this.catalog, knowledge: this.knowledge,
              model: this.model, checkpointer: await createAgentCheckpointer(pool), authorization: async (userId) => this.context(userId) });
          }
          await this.runner.run(run.userId, run.id);
        }
        await this.dataSource.query('UPDATE agent_runs SET "nextDispatchAt"=clock_timestamp()+interval \'2 seconds\' WHERE id=$1 AND "userId"=$2', [run.id, run.userId]);
      } catch (error) {
        if (error instanceof Error && error.message === 'AGENT_GRAPH_BUSY') continue;
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'AGENT_EXECUTION_FAILED';
        // 取消优先于错误暂停，避免在模型返回的取消错误上永久搁置取消请求。
        await this.dataSource.query(`UPDATE agent_runs SET "executionPaused"=NOT "cancelRequested","lastErrorCode"=$3
          WHERE id=$1 AND "userId"=$2 AND status NOT IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT')`, [run.id, run.userId, code]);
      }
    }
  }

  /** 保存表就是耐久投递源；提交后崩溃仍会重试，队列复用固定文档键去重。 */
  private async dispatchIndexing(): Promise<void> {
    const rows: Array<{ id: string; documentId: string; userId: string; title: string; content: string; deletedAt: Date | null }> =
      await this.dataSource.query(`SELECT s.id,s."documentId",s."userId",d.title,d.content,d."deletedAt" FROM agent_document_saves s
        LEFT JOIN documents d ON d.id=s."documentId" AND d."userId"=s."userId"
        WHERE s.status='SAVED' AND s."indexScheduledAt" IS NULL ORDER BY s."savedAt",s.id LIMIT 10`);
    for (const row of rows) {
      // 文档已删除时不重建正文/索引。调度只读取当前内容，不使用保存时的过期快照。
      if (!row.title || row.deletedAt || await this.index.scheduleReindex({ docId: row.documentId, userId: row.userId, title: row.title, content: row.content })) {
        await this.dataSource.query('UPDATE agent_document_saves SET "indexScheduledAt"=clock_timestamp() WHERE id=$1 AND "userId"=$2', [row.id, row.userId]);
      }
    }
  }

  /** 复用 Graph 的会话锁，确认无非终态工具调用后落取消终态；不会回滚已保存文档。 */
  private async settleCancellation(run: AgentRun): Promise<void> {
    const lock = this.dataSource.createQueryRunner();
    await lock.connect();
    const key = agentCheckpointKey(run.userId, run.id);
    let acquired = false;
    try {
      [ { acquired } ] = await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [key]);
      if (!acquired) return;
      await this.dataSource.transaction('READ COMMITTED', async (manager) => {
        await lockAgentOwner(manager, run.userId);
        const current = await manager.getRepository(AgentRun).findOneByOrFail({ id: run.id, userId: run.userId });
        if (isAgentRunTerminal(current.status)) return;
        const active = await manager.query(`SELECT id FROM agent_tool_calls WHERE "runId"=$1 AND "userId"=$2
          AND status NOT IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') LIMIT 1`, [run.id, run.userId]);
        if (active.length) return;
        await new AgentRunWriter(manager).transition(run.userId, run.id, current, { type: 'CANCEL_SETTLED' });
      });
    } finally {
      try { if (acquired) await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); }
      finally { await lock.release(); }
    }
  }
}
