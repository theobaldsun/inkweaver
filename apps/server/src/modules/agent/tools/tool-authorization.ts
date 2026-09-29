/** 资源授权与确认事务入口。依赖调用记录、当前 Catalog/策略及文档归属，不执行适配器。 */
import { randomUUID } from 'node:crypto';

import { ToolCallPreparer } from './tool-call-preparer';
import { ToolCallStore } from './tool-call.store';
import { bindingDigest, inspectToolResources } from './tool-resources';
import { lockAgentOwner } from '../agent-data.cleanup';
import { AgentRun } from '../entity/agent-run.entity';

import type { ToolCatalog } from './tool-catalog';
import type { ToolPolicyContext } from './tool-policy';
import type { ToolResourceScope, ToolResourceSnapshot } from './tool-resources';
import type { AgentToolCall } from '../entity/agent-tool-call.entity';
import type { EntityManager } from 'typeorm';

export interface ToolAuthorizationContext {
  /** 认证、当前权限及允许工具均由服务端构造。 */
  policy: ToolPolicyContext;
  /** 服务端解析的 Run 来源范围，不从模型输出读取。 */
  scope: ToolResourceScope;
}
export interface AgentConfirmation {
  /** 确认记录 UUID；不是 bearer token，使用时必须匹配用户及调用。 */
  id: string;
  /** 固定逻辑调用 UUID。 */
  callId: string;
  /** 所属 Run UUID。 */
  runId: string;
  /** 认证用户 UUID。 */
  userId: string;
  /** 首版摘要编码版本。 */
  bindingVersion: 1;
  /** 固定参数、身份、来源与资源版本的 SHA-256。 */
  digest: string;
  /** 展示/校验用资源快照，不含正文。 */
  resources: ToolResourceSnapshot[];
  /** 审批结果；批准仍需执行前复核。 */
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  /** 数据库创建时间。 */
  createdAt: Date;
  /** 数据库过期时间。 */
  expiresAt: Date;
  /** 未处理为 null。 */
  resolvedAt: Date | null;
}

export class ToolAuthorization {
  /** manager 可来自上层领取事务，Catalog 必须与准备/执行共用。 */
  constructor(private readonly manager: EntityManager, private readonly catalog: ToolCatalog) {}

  /** 创建授权状态与确认记录；同调用重复请求不刷新有效期。ttlMs 为服务端配置，1～30 分钟。 */
  async authorize(userId: string, runId: string, callId: string, context: ToolAuthorizationContext, ttlMs = 300000): Promise<{ call: AgentToolCall; confirmation: AgentConfirmation | null }> {
    if (!Number.isInteger(ttlMs) || ttlMs < 60000 || ttlMs > 1800000) throw new Error('INVALID_CONFIRMATION_TTL');
    const snapshot = structuredClone(context);
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const store = new ToolCallStore(manager);
      let call = await this.load(manager, userId, runId, callId);
      if (!['PREPARED', 'WAITING_CONFIRMATION', 'READY'].includes(call.status)) throw new Error('CALL_NOT_AUTHORIZABLE');
      const checked = await this.inspect(manager, call, snapshot);
      let confirmation = await this.find(manager, userId, runId, callId);
      if (call.requiresConfirmation) {
        if (confirmation && confirmation.digest !== checked.digest) throw new Error('CONFIRMATION_BINDING_CHANGED');
        if (!confirmation) {
          if (call.status !== 'PREPARED') throw new Error('CONFIRMATION_REQUIRED');
          const rows = await manager.query(`INSERT INTO agent_confirmations
            (id, "callId", "runId", "userId", digest, resources, status, "expiresAt")
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,'PENDING',clock_timestamp() + $7 * interval '1 millisecond') RETURNING *`,
          [randomUUID(), callId, runId, userId, checked.digest, JSON.stringify(checked.resources), ttlMs]);
          confirmation = rows[0];
        }
      }
      if (call.status === 'PREPARED') call = await store.transition(userId, runId, callId, call.revision, { type: 'RESOURCES_APPROVED' });
      return { call, confirmation };
    });
  }

  /** 用户接受/拒绝；重复相同决定幂等，冲突决定拒绝。过期落为 EXPIRED，不把过期当批准。 */
  async decide(userId: string, runId: string, callId: string, confirmationId: string, accept: boolean, context: ToolAuthorizationContext): Promise<AgentConfirmation> {
    if (typeof accept !== 'boolean') throw new Error('INVALID_CONFIRMATION_DECISION');
    const snapshot = structuredClone(context);
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const call = await this.load(manager, userId, runId, callId);
      const confirmation = await this.find(manager, userId, runId, callId);
      if (!confirmation || confirmation.id !== confirmationId) throw new Error('CONFIRMATION_NOT_FOUND');
      const status = accept ? 'APPROVED' : 'REJECTED';
      if (confirmation.status !== 'PENDING') {
        if (confirmation.status === status || confirmation.status === 'EXPIRED') return confirmation;
        throw new Error('CONFIRMATION_DECISION_CONFLICT');
      }
      const expired = await this.isExpired(manager, confirmation);
      if (!expired && accept) {
        const checked = await this.inspect(manager, call, snapshot);
        if (checked.digest !== confirmation.digest) throw new Error('CONFIRMATION_BINDING_CHANGED');
      }
      await new ToolCallStore(manager).transition(userId, runId, callId, call.revision,
        { type: expired ? 'EXPIRED' : accept ? 'CONFIRMED' : 'CANCEL_REQUESTED' });
      return this.resolve(manager, confirmation, expired ? 'EXPIRED' : status);
    });
  }

  /** 按数据库时钟处理到期；仅处理待确认/待执行调用，绝不把在途执行标成停止。 */
  async expire(userId: string, runId: string, callId: string): Promise<AgentConfirmation | null> {
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const call = await this.load(manager, userId, runId, callId);
      const confirmation = await this.find(manager, userId, runId, callId);
      if (!confirmation || !['PENDING', 'APPROVED'].includes(confirmation.status) || !(await this.isExpired(manager, confirmation))) return confirmation;
      if (!['WAITING_CONFIRMATION', 'READY'].includes(call.status)) return confirmation;
      await new ToolCallStore(manager).transition(userId, runId, callId, call.revision, { type: 'EXPIRED' });
      return this.resolve(manager, confirmation, 'EXPIRED');
    });
  }

  /** 内部维护扫描：只枚举数据库已到期且尚可安全结束的确认，再逐用户锁重验。 */
  async expireDue(limit = 50): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_CONFIRMATION_SCAN');
    const candidates: { id: string; userId: string; runId: string; callId: string }[] = await this.manager.query(`SELECT f.id,f."userId",f."runId",f."callId"
      FROM agent_confirmations f JOIN agent_tool_calls c
        ON c.id=f."callId" AND c."runId"=f."runId" AND c."userId"=f."userId"
      WHERE f.status IN ('PENDING','APPROVED') AND f."expiresAt"<=clock_timestamp()
        AND c.status IN ('WAITING_CONFIRMATION','READY')
      ORDER BY f."expiresAt",f.id LIMIT $1`, [limit]);
    const expired: string[] = [];
    for (const candidate of candidates) {
      const confirmation = await this.expire(candidate.userId, candidate.runId, candidate.callId);
      if (confirmation?.status === 'EXPIRED') expired.push(candidate.id);
    }
    return expired;
  }

  /** 由 ToolExecutor 领取事务及 AgentDocumentWriter 保存事务调用；复核策略、参数、资源和确认，不签发可缓存令牌。 */
  async recheck(userId: string, runId: string, callId: string, context: ToolAuthorizationContext): Promise<{ call: AgentToolCall; resources: ToolResourceSnapshot[] }> {
    const snapshot = structuredClone(context);
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const call = await this.load(manager, userId, runId, callId);
      const run = await manager.getRepository(AgentRun).findOneBy({ id: runId, userId });
      if (call.status !== 'READY' || call.cancelRequested || run?.status !== 'RUNNING') throw new Error('CALL_NOT_READY');
      const checked = await this.inspect(manager, call, snapshot);
      if (call.requiresConfirmation) {
        const confirmation = await this.find(manager, userId, runId, callId);
        if (!confirmation || confirmation.status !== 'APPROVED' || await this.isExpired(manager, confirmation)) throw new Error('CONFIRMATION_REQUIRED');
        if (confirmation.digest !== checked.digest) throw new Error('CONFIRMATION_BINDING_CHANGED');
      }
      return { call, resources: checked.resources };
    });
  }

  private async load(manager: EntityManager, userId: string, runId: string, callId: string): Promise<AgentToolCall> {
    const call = await new ToolCallStore(manager).get(userId, runId, callId);
    if (!call) throw new Error('CALL_NOT_FOUND');
    return call;
  }

  private async inspect(manager: EntityManager, call: AgentToolCall, context: ToolAuthorizationContext) {
    if (context.policy.principal?.userId !== call.userId) throw new Error('AUTHORIZATION_IDENTITY_MISMATCH');
    const tool = this.catalog.resolve(call.toolName, call.toolVersion);
    if (tool.definition.origin.kind !== call.originKind || (tool.definition.origin.kind === 'mcp' && tool.definition.origin.connectionId !== call.connectionId)) throw new Error('TOOL_ORIGIN_CHANGED');
    const prepared = new ToolCallPreparer(this.catalog).prepare({ name: call.toolName, expectedVersion: call.toolVersion,
      input: call.input as Parameters<ToolCallPreparer['prepare']>[0]['input'] }, context.policy);
    if (prepared.status !== 'prepared') throw new Error('TOOL_AUTHORIZATION_DENIED');
    if (prepared.requiresConfirmation !== call.requiresConfirmation) throw new Error('CONFIRMATION_POLICY_CHANGED');
    if (!tool.resources) throw new Error('RESOURCE_RESOLVER_REQUIRED');
    const resources = await inspectToolResources(manager, call.userId, tool.resources(prepared.call.input, call.userId), context.scope);
    const digest = bindingDigest({ bindingVersion: 1, userId: call.userId, runId: call.runId, callId: call.id,
      name: call.toolName, version: call.toolVersion, originKind: call.originKind, connectionId: call.connectionId,
      input: call.input, resources });
    return { resources, digest };
  }

  private async find(manager: EntityManager, userId: string, runId: string, callId: string): Promise<AgentConfirmation | null> {
    const rows = await manager.query('SELECT * FROM agent_confirmations WHERE "userId"=$1 AND "runId"=$2 AND "callId"=$3', [userId, runId, callId]);
    return rows[0] ?? null;
  }

  private async isExpired(manager: EntityManager, confirmation: AgentConfirmation): Promise<boolean> {
    const [row] = await manager.query('SELECT "expiresAt" <= clock_timestamp() AS expired FROM agent_confirmations WHERE id=$1', [confirmation.id]);
    return row.expired;
  }

  private async resolve(manager: EntityManager, confirmation: AgentConfirmation, status: AgentConfirmation['status']): Promise<AgentConfirmation> {
    const rows = await manager.query(`WITH updated AS (UPDATE agent_confirmations SET status=$2, "resolvedAt"=clock_timestamp() WHERE id=$1 RETURNING *) SELECT * FROM updated`, [confirmation.id, status]);
    return rows[0];
  }
}
