/** 模型调用审计：每次实际发起适配器调用独立记录，不以 Checkpoint 轮次覆盖重试成本。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentModelCalls1790294400000 implements MigrationInterface {
  name = 'CreateAgentModelCalls1790294400000';
  /** 用量只接受非负安全整数；null 表示未知，不推算总用量或费用。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE agent_model_calls (
      id uuid PRIMARY KEY, "runId" uuid NOT NULL, "userId" uuid NOT NULL,
      model text, status varchar(16) NOT NULL DEFAULT 'STARTED',
      "inputTokens" double precision, "outputTokens" double precision, "totalTokens" double precision,
      "latencyMs" double precision, "errorCode" varchar(64),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "endedAt" timestamptz,
      FOREIGN KEY ("runId","userId") REFERENCES agent_runs(id,"userId") ON DELETE CASCADE,
      CHECK (status IN ('STARTED','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')),
      CHECK ((status='STARTED' AND "endedAt" IS NULL) OR (status<>'STARTED' AND "endedAt" IS NOT NULL)),
      CHECK ((status IN ('STARTED','SUCCEEDED') AND "errorCode" IS NULL) OR (status IN ('FAILED','CANCELLED','TIMED_OUT') AND "errorCode" IS NOT NULL))
    )`);
    for (const column of ['inputTokens', 'outputTokens', 'totalTokens', 'latencyMs']) {
      await runner.query(`ALTER TABLE agent_model_calls ADD CHECK ("${column}" IS NULL OR
        ("${column}" >= 0 AND "${column}" <= 9007199254740991 AND floor("${column}")="${column}"))`);
    }
    await runner.query('CREATE INDEX "IDX_agent_model_calls_owner_run" ON agent_model_calls ("userId","runId","createdAt",id)');
  }
  /** 仅撤销本模块审计表。 */
  async down(runner: QueryRunner): Promise<void> { await runner.query('DROP TABLE agent_model_calls'); }
}
