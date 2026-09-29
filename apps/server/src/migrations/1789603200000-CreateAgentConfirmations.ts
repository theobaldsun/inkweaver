/** 确认绑定属于固定逻辑调用；摘要不携带正文、凭据或可复用授权。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentConfirmations1789603200000 implements MigrationInterface {
  name = 'CreateAgentConfirmations1789603200000';
  /** 一次调用最多一个确认；绑定变化必须新建调用，不重写已批准内容。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE agent_confirmations (
      id uuid PRIMARY KEY, "callId" uuid NOT NULL UNIQUE, "runId" uuid NOT NULL, "userId" uuid NOT NULL,
      "bindingVersion" integer NOT NULL DEFAULT 1 CHECK ("bindingVersion" = 1),
      digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
      resources jsonb NOT NULL CHECK (jsonb_typeof(resources) = 'array'),
      status varchar(16) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "expiresAt" timestamptz NOT NULL, "resolvedAt" timestamptz,
      CHECK ("expiresAt" > "createdAt"),
      CHECK ((status = 'PENDING' AND "resolvedAt" IS NULL) OR (status <> 'PENDING' AND "resolvedAt" IS NOT NULL)),
      FOREIGN KEY ("callId", "runId", "userId") REFERENCES agent_tool_calls (id, "runId", "userId") ON DELETE CASCADE
    )`);
  }
  /** 按迁移逆序撤销。 */
  async down(runner: QueryRunner): Promise<void> { await runner.query('DROP TABLE agent_confirmations'); }
}
