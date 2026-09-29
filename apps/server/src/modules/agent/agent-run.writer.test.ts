import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSource, QueryResult } from 'typeorm';

import { AgentRunWriter } from './agent-run.writer';
import { AgentRun } from './entity/agent-run.entity';

class OfflineSource extends DataSource {
  /** 构建映射，禁止连接数据库。 */
  async prepare(): Promise<void> { await this.buildMetadatas(); }
}

test('事务路径：事件成功才提交；失败或序号耗尽时回滚', async () => {
  for (const outcome of ['success', 'failure', 'exhausted']) {
    const source = new OfflineSource({ type: 'postgres', entities: [AgentRun] });
    await source.prepare();
    const runner = source.createQueryRunner();
    const actions: string[] = [];
    runner.startTransaction = async () => { actions.push('begin'); Object.assign(runner, { isTransactionActive: true }); };
    runner.commitTransaction = async () => { actions.push('commit'); Object.assign(runner, { isTransactionActive: false }); };
    runner.rollbackTransaction = async () => { actions.push('rollback'); Object.assign(runner, { isTransactionActive: false }); };
    runner.query = (async (sql: string) => {
      if (sql.includes('FOR UPDATE')) { actions.push('owner'); return [{ id: 'owner' }]; }
      if (sql.includes('WITH allocated')) {
        actions.push('event');
        if (outcome === 'failure') throw new Error('injected');
        return outcome === 'exhausted' ? [] : [{ sequence: 1 }];
      }
      actions.push('run');
      const result = new QueryResult();
      result.records = [{ id: '22222222-2222-4222-8222-222222222222', userId: '11111111-1111-4111-8111-111111111111', status: 'CREATED', revision: 0 }];
      result.raw = result.records;
      result.affected = 1;
      return result;
    }) as typeof runner.query;
    const operation = new AgentRunWriter(runner.manager).create('11111111-1111-4111-8111-111111111111', { mode: 'task', goal: 'x', workflowVersion: 'v1' });
    if (outcome === 'success') await operation;
    else await assert.rejects(operation);
    assert.deepEqual(actions, ['begin', 'owner', 'run', 'event', outcome === 'success' ? 'commit' : 'rollback']);
  }
});
