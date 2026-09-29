/**
 * Run 变更的事务入口：状态、事件序号和事件正文全部提交或全部回滚。
 * 由 Graph、保存及取消收尾调用；事件事实由上层证明，本层不替代授权与在途调用检查。
 */
import { lockAgentOwner } from './agent-data.cleanup';
import { appendAgentEvent } from './agent-event.writer';
import { AgentRunStore } from './agent-run.store';
import { AgentRun } from './entity/agent-run.entity';

import type { AgentRunEvent } from './agent-run-lifecycle';
import type { AgentRunExpectedState, CreateAgentRun } from './agent-run.store';
import type { EntityManager } from 'typeorm';

export class AgentRunWriter {
  /** 生产注入数据源 manager；事务 manager 可用于组合更大的业务事务。 */
  constructor(private readonly manager: EntityManager) {}

  /** 新 Run 与 RUN_CREATED 同事务保存；请求去重不属于此方法。 */
  async create(userId: string, input: CreateAgentRun): Promise<AgentRun> {
    const snapshot = { mode: input.mode, goal: input.goal, workflowVersion: input.workflowVersion };
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await new AgentRunStore(manager.getRepository(AgentRun)).create(userId, snapshot);
      await appendAgentEvent(manager, run, { schemaVersion: 1, type: 'RUN_CREATED', payload: { status: run.status, revision: run.revision } });
      return run;
    });
  }

  /** 先条件更新取得行锁，再追加事件；任何后续错误向外传播并触发事务回滚。 */
  async transition(userId: string, runId: string, expected: AgentRunExpectedState, event: AgentRunEvent): Promise<AgentRun> {
    const previous = { status: expected.status, revision: expected.revision };
    const cause = event.type;
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await new AgentRunStore(manager.getRepository(AgentRun)).transition(userId, runId, previous, { type: cause });
      await appendAgentEvent(manager, run, { schemaVersion: 1, type: 'RUN_STATUS_CHANGED',
        payload: { from: previous.status, to: run.status, cause, revision: run.revision } });
      return run;
    });
  }

}
