/** 只读执行的预算、租约与受限结果；不启用自动同步。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentReadExecution1789689600000 implements MigrationInterface {
  name = 'AddAgentReadExecution1789689600000';
  /** 预算上限属于 Run；每次尝试占一个调用名额，失败也计入已用量。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_runs ADD COLUMN "toolCallLimit" integer NOT NULL DEFAULT 20 CHECK ("toolCallLimit" > 0)');
    await runner.query('ALTER TABLE agent_tool_attempts ADD COLUMN "leaseExpiresAt" timestamptz');
    await runner.query(`CREATE TABLE agent_budget_reservations (
      "attemptId" uuid PRIMARY KEY REFERENCES agent_tool_attempts(id) ON DELETE CASCADE,
      status varchar(16) NOT NULL CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED')),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "settledAt" timestamptz,
      CHECK ((status = 'RESERVED' AND "settledAt" IS NULL) OR (status <> 'RESERVED' AND "settledAt" IS NOT NULL))
    )`);
    await runner.query(`CREATE TABLE agent_tool_results (
      "attemptId" uuid PRIMARY KEY REFERENCES agent_tool_attempts(id) ON DELETE CASCADE,
      output jsonb, "errorCode" varchar(64), "outputBytes" integer NOT NULL CHECK ("outputBytes" >= 0),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((output IS NOT NULL AND "errorCode" IS NULL) OR (output IS NULL AND "errorCode" IS NOT NULL))
    )`);
  }
  /** 先移除子表再撤销列，业务库执行仍需独立部署授权。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE agent_tool_results');
    await runner.query('DROP TABLE agent_budget_reservations');
    await runner.query('ALTER TABLE agent_tool_attempts DROP COLUMN "leaseExpiresAt"');
    await runner.query('ALTER TABLE agent_runs DROP COLUMN "toolCallLimit"');
  }
}
