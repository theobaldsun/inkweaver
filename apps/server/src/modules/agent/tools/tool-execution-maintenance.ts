/**
 * Agent 工具执行单轮维护：处理过期只读租约、退避到期和确认到期。
 * 轮询由 AgentService 的统一调度循环驱动（每轮结束后才安排下一轮），本类不再自带定时器，
 * 避免同一进程出现两套维护节奏；单轮入口保留给隔离测试和未来 Worker 复用。
 */
import { ToolAuthorization } from './tool-authorization';
import { ToolExecutionControl } from './tool-execution-control';

import type { ToolCatalog } from './tool-catalog';
import type { ToolExecutionControlOptions } from './tool-execution-control';
import type { EntityManager } from 'typeorm';

export interface ToolExecutionMaintenanceOptions extends ToolExecutionControlOptions {
  /** 每类扫描单轮最多处理的记录数。 */
  batchSize?: number;
}

export interface ToolExecutionMaintenanceResult {
  /** 本轮完成崩溃收尾或重试安排的 Attempt。 */
  recoveredAttemptIds: string[];
  /** 从 RETRY_WAIT 推回 READY 的调用。 */
  readyCallIds: string[];
  /** 标为 EXPIRED 的确认记录。 */
  expiredConfirmationIds: string[];
}

/**
 * 单进程单轮维护器。多实例可同时运行：具体写入仍通过用户锁、状态条件和租约重验裁决。
 */
export class ToolExecutionMaintenance {
  private readonly batchSize: number;
  private readonly control: ToolExecutionControl;

  constructor(private readonly manager: EntityManager, private readonly catalog: ToolCatalog,
    options: ToolExecutionMaintenanceOptions = {}) {
    this.batchSize = options.batchSize ?? 50;
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 100) {
      throw new Error('INVALID_MAINTENANCE_OPTIONS');
    }
    this.control = new ToolExecutionControl(manager, { ...options, catalog });
  }

  /** 单轮执行，由统一调度循环（或隔离测试）驱动；本方法不自行安排下一轮。 */
  async runOnce(): Promise<ToolExecutionMaintenanceResult> {
    const recoveredAttemptIds = await this.control.recoverExpiredAll(this.batchSize);
    const readyCallIds = await this.control.advanceDueRetries(this.batchSize);
    const expiredConfirmationIds = await new ToolAuthorization(this.manager, this.catalog).expireDue(this.batchSize);
    return { recoveredAttemptIds, readyCallIds, expiredConfirmationIds };
  }
}
