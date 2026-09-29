/** 标识执行所有者和调用边界；旧预算没有只读证明，默认禁止自动恢复。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentExecutionRecovery1789776000000 implements MigrationInterface {
  name = 'AddAgentExecutionRecovery1789776000000';
  /** invocationStartedAt 在调用前持久化；不代表供应商一定收到请求。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_tool_attempts ADD COLUMN "leaseOwner" uuid, ADD COLUMN "invocationStartedAt" timestamptz');
    await runner.query(`ALTER TABLE agent_budget_reservations ADD COLUMN "executionKind" varchar(24) NOT NULL DEFAULT 'legacy_unknown'
      CHECK ("executionKind" IN ('legacy_unknown', 'builtin_read'))`);
    await runner.query(`CREATE INDEX "IDX_agent_attempts_expired" ON agent_tool_attempts ("userId", "leaseExpiresAt") WHERE status='STARTED'`);
  }
  /** 撤销本次字段和索引，不改写已保存结果。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX "IDX_agent_attempts_expired"');
    await runner.query('ALTER TABLE agent_budget_reservations DROP COLUMN "executionKind"');
    await runner.query('ALTER TABLE agent_tool_attempts DROP COLUMN "invocationStartedAt", DROP COLUMN "leaseOwner"');
  }
}
