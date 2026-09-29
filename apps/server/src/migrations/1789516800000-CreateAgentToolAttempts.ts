/** 单次执行历史；调用、尝试、事件由同一事务维护，不启用自动同步。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentToolAttempts1789516800000 implements MigrationInterface {
  name = 'CreateAgentToolAttempts1789516800000';

  /** 不伪造旧执行历史；已有 attemptCount 的调用需人工核对，不能凭空补成功记录。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_tool_calls ADD CONSTRAINT "UQ_agent_tool_calls_identity" UNIQUE (id, "runId", "userId")');
    await runner.query(`CREATE TABLE agent_tool_attempts (
      id uuid PRIMARY KEY,
      "callId" uuid NOT NULL,
      "runId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "attemptNumber" integer NOT NULL CHECK ("attemptNumber" > 0),
      "startRevision" integer NOT NULL CHECK ("startRevision" > 0),
      status varchar(32) NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN', 'CANCELLED')),
      "startedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "endedAt" timestamptz,
      CONSTRAINT "FK_agent_tool_attempts_call" FOREIGN KEY ("callId", "runId", "userId")
        REFERENCES agent_tool_calls (id, "runId", "userId") ON DELETE CASCADE,
      CONSTRAINT "UQ_agent_tool_attempts_number" UNIQUE ("callId", "attemptNumber"),
      CONSTRAINT "CHK_agent_tool_attempts_time" CHECK (
        (status = 'STARTED' AND "endedAt" IS NULL) OR
        (status <> 'STARTED' AND "endedAt" IS NOT NULL AND "endedAt" >= "startedAt")
      )
    )`);
    await runner.query(`CREATE UNIQUE INDEX "UQ_agent_tool_attempts_active" ON agent_tool_attempts ("callId") WHERE status = 'STARTED'`);
  }

  /** 先撤销尝试，再撤销父表新增的组合唯一约束。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE agent_tool_attempts');
    await runner.query('ALTER TABLE agent_tool_calls DROP CONSTRAINT "UQ_agent_tool_calls_identity"');
  }
}
