/** 持久化工具调用的退避截止时间；应用重启后仍能判断何时允许重新复核。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentRetryScheduling1789862400000 implements MigrationInterface {
  name = 'AddAgentRetryScheduling1789862400000';

  /** 建立全局到期扫描索引；状态与截止时间的一致性由同一业务事务维护。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_tool_calls ADD COLUMN "retryNotBefore" timestamptz');
    await runner.query('CREATE INDEX "IDX_agent_tool_calls_retry_due" ON agent_tool_calls ("retryNotBefore", id) WHERE status = \'RETRY_WAIT\'');
  }

  /** 先移除依赖索引，再撤销字段。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX "IDX_agent_tool_calls_retry_due"');
    await runner.query('ALTER TABLE agent_tool_calls DROP COLUMN "retryNotBefore"');
  }
}
