/**
 * 工具调用重试策略与退避调度的共享实现：执行器与恢复控制必须共用同一份语义。
 * 只负责确定性的退避时长、剩余次数判断、数据库截止时间和 RETRY_WAIT→READY 复核；
 * 不裁决取消、确认、授权或预算，也不代替状态机判断重试是否安全。
 * 截止时间一律由 PostgreSQL clock_timestamp 计算，避免应用时钟漂移影响恢复。
 */
import { ToolCallStore } from './tool-call.store';
import { lockAgentOwner } from '../agent-data.cleanup';

import type { EntityManager } from 'typeorm';

/** 重试相关配置；缺省值与边界由 ToolRetryPolicy 统一裁决。 */
export interface ToolRetryOptions {
  /** 单个逻辑调用允许的最大执行尝试数；使用持久化 attemptCount 跨重启计数。 */
  maxAttempts?: number;
  /** 首次安全重试的退避毫秒数。 */
  retryBaseDelayMs?: number;
  /** 指数退避上限毫秒数。 */
  retryMaxDelayMs?: number;
}

/** 定位一个逻辑调用；userId 只来自已认证服务端上下文。 */
export interface ToolRetryTarget {
  /** 已认证用户 UUID。 */
  userId: string;
  /** 所属 Run UUID。 */
  runId: string;
  /** 逻辑调用 UUID。 */
  callId: string;
}

/**
 * 确定性的重试预算与退避计算；不持有连接、不读取调用状态。
 * 执行器（领取前判断）与恢复控制（崩溃恢复判断）必须构造等价策略。
 */
export class ToolRetryPolicy {
  /** 单个逻辑调用允许的最大尝试数。 */
  readonly maxAttempts: number;
  /** 首次退避基数，毫秒。 */
  private readonly retryBaseDelayMs: number;
  /** 退避上限，毫秒。 */
  private readonly retryMaxDelayMs: number;

  constructor(options: ToolRetryOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 5000;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 10
      || !Number.isInteger(this.retryBaseDelayMs) || this.retryBaseDelayMs < 10 || this.retryBaseDelayMs > 30000
      || !Number.isInteger(this.retryMaxDelayMs) || this.retryMaxDelayMs < this.retryBaseDelayMs || this.retryMaxDelayMs > 60000) {
      throw new Error('INVALID_RETRY_OPTIONS');
    }
  }

  /**
   * 已启动尝试数是否仍低于上限。
   * attemptCount 已持久化并由状态机维护，因此重启不会重置重试次数。
   * @param attemptCount 调用记录上的已启动尝试数。
   */
  canRetry(attemptCount: number): boolean {
    return attemptCount < this.maxAttempts;
  }

  /**
   * 以已启动尝试数计算确定性指数退避，避免测试和恢复依赖随机时钟。
   * @param attemptCount 调用记录上的已启动尝试数，从 1 开始。
   */
  delayFor(attemptCount: number): number {
    return Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * (2 ** Math.max(0, attemptCount - 1)));
  }

  /**
   * 调用已进入 RETRY_WAIT 后写入数据库截止时间；未进入该状态时写不进去。
   * 条件更新失败说明状态已被取消、恢复或完成路径改变，不能静默继续等待。
   * @param manager 当前上层事务的 manager；与本调用的状态迁移同一事务提交。
   * @param target 逻辑调用定位。
   * @param attemptCount 本次退避依据的尝试数。
   */
  async schedule(manager: EntityManager, target: ToolRetryTarget, attemptCount: number): Promise<void> {
    const rows: unknown[] = await manager.query(`WITH updated AS (
      UPDATE agent_tool_calls SET "retryNotBefore"=clock_timestamp() + $4 * interval '1 millisecond'
      WHERE id=$1 AND "runId"=$2 AND "userId"=$3 AND status='RETRY_WAIT' RETURNING id
    ) SELECT id FROM updated`, [target.callId, target.runId, target.userId, this.delayFor(attemptCount)]);
    if (rows.length !== 1) throw new Error('RETRY_SCHEDULE_CONFLICT');
  }
}

/**
 * 将数据库时钟已到期的 RETRY_WAIT 重新放回 READY；真正执行仍须重新走执行器领取。
 * 已处于 READY 视为退避已合法结束，不能被误判为取消；取消请求、终态或未到期一律不动。
 * 用户锁内逐条重验，多个调度者可并发调用，状态机拒绝非法迁移。
 * @param manager 非事务或事务 manager；本函数自行开启 READ COMMITTED 事务。
 * @param target 逻辑调用定位。
 * @returns 是否已处于或已推回 READY。
 */
export async function advanceDueRetry(manager: EntityManager, target: ToolRetryTarget): Promise<boolean> {
  const { userId, runId, callId } = target;
  return manager.transaction('READ COMMITTED', async (transaction) => {
    await lockAgentOwner(transaction, userId);
    const store = new ToolCallStore(transaction);
    const call = await store.get(userId, runId, callId);
    // 维护扫描可能已先把同一调用推进 READY；这表示退避已经合法结束，不应把它误当作取消。
    if (call?.status === 'READY' && !call.cancelRequested) return true;
    if (!call || call.status !== 'RETRY_WAIT' || call.cancelRequested || !call.retryNotBefore) return false;
    const [due] = await transaction.query(`SELECT "retryNotBefore"<=clock_timestamp() AS due FROM agent_tool_calls
      WHERE id=$1 AND "runId"=$2 AND "userId"=$3`, [callId, runId, userId]);
    if (!due?.due) return false;
    // Store 在离开 RETRY_WAIT 时同一状态更新清理 retryNotBefore。
    await store.transition(userId, runId, callId, call.revision, { type: 'RETRY_DUE' });
    return true;
  });
}
