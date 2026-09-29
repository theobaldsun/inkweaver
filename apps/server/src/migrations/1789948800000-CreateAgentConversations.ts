/**
 * 建立 Agent Thread/Message 事实来源，并把 Run 绑定到触发消息。
 * 请求幂等键只在同一用户、同一 Thread 内唯一；重复键不得静默替换正文。
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentConversations1789948800000 implements MigrationInterface {
  name = 'CreateAgentConversations1789948800000';

  /** 创建会话、消息及 Run 关联；旧 Run 保持 threadId/triggerMessageId 为 null。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE agent_threads (
      id uuid PRIMARY KEY,
      "userId" uuid NOT NULL,
      title varchar(200),
      "archivedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "lastActivityAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "FK_agent_threads_user" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "UQ_agent_threads_id_user" UNIQUE (id,"userId"),
      CONSTRAINT "CHK_agent_threads_title" CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 200)
    )`);
    await runner.query('CREATE INDEX "IDX_agent_threads_user_activity" ON agent_threads ("userId","lastActivityAt" DESC,id DESC)');

    await runner.query(`CREATE TABLE agent_messages (
      id uuid PRIMARY KEY,
      "threadId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      role varchar(16) NOT NULL,
      "contentVersion" smallint NOT NULL DEFAULT 1,
      content jsonb NOT NULL,
      "requestKey" varchar(128),
      "requestDigest" char(64),
      "runId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "FK_agent_messages_thread" FOREIGN KEY ("threadId","userId") REFERENCES agent_threads(id,"userId") ON DELETE CASCADE,
      CONSTRAINT "UQ_agent_messages_id_thread_user" UNIQUE (id,"threadId","userId"),
      CONSTRAINT "CHK_agent_messages_role" CHECK (role IN ('user','assistant')),
      CONSTRAINT "CHK_agent_messages_content_version" CHECK ("contentVersion" = 1),
      CONSTRAINT "CHK_agent_messages_content" CHECK (jsonb_typeof(content) = 'array' AND jsonb_array_length(content) > 0),
      CONSTRAINT "CHK_agent_messages_request_pair" CHECK (("requestKey" IS NULL) = ("requestDigest" IS NULL)),
      CONSTRAINT "CHK_agent_messages_request_role" CHECK ("requestKey" IS NULL OR role = 'user'),
      CONSTRAINT "CHK_agent_messages_request_key" CHECK ("requestKey" IS NULL OR length(btrim("requestKey")) BETWEEN 1 AND 128),
      CONSTRAINT "CHK_agent_messages_request_digest" CHECK ("requestDigest" IS NULL OR "requestDigest" ~ '^[0-9a-f]{64}$')
    )`);
    await runner.query('CREATE UNIQUE INDEX "UQ_agent_messages_request" ON agent_messages ("userId","threadId","requestKey") WHERE "requestKey" IS NOT NULL');
    await runner.query('CREATE INDEX "IDX_agent_messages_thread_created" ON agent_messages ("userId","threadId","createdAt",id)');

    await runner.query('ALTER TABLE agent_runs ADD COLUMN "threadId" uuid, ADD COLUMN "triggerMessageId" uuid');
    await runner.query('ALTER TABLE agent_runs ADD CONSTRAINT "FK_agent_runs_thread" FOREIGN KEY ("threadId","userId") REFERENCES agent_threads(id,"userId") ON DELETE CASCADE');
    await runner.query('ALTER TABLE agent_runs ADD CONSTRAINT "FK_agent_runs_trigger_message" FOREIGN KEY ("triggerMessageId","threadId","userId") REFERENCES agent_messages(id,"threadId","userId") ON DELETE RESTRICT');
    await runner.query('ALTER TABLE agent_runs ADD CONSTRAINT "CHK_agent_runs_message_binding" CHECK (("threadId" IS NULL) = ("triggerMessageId" IS NULL))');
    await runner.query('CREATE UNIQUE INDEX "UQ_agent_runs_trigger_message" ON agent_runs ("triggerMessageId") WHERE "triggerMessageId" IS NOT NULL');

    await runner.query('ALTER TABLE agent_messages ADD CONSTRAINT "FK_agent_messages_run" FOREIGN KEY ("runId") REFERENCES agent_runs(id) ON DELETE SET NULL');
  }

  /** 按依赖逆序撤销；不使用 CASCADE 掩盖后续迁移依赖。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_messages DROP CONSTRAINT "FK_agent_messages_run"');
    await runner.query('DROP INDEX "UQ_agent_runs_trigger_message"');
    await runner.query('ALTER TABLE agent_runs DROP CONSTRAINT "CHK_agent_runs_message_binding", DROP CONSTRAINT "FK_agent_runs_trigger_message", DROP CONSTRAINT "FK_agent_runs_thread"');
    await runner.query('ALTER TABLE agent_runs DROP COLUMN "triggerMessageId", DROP COLUMN "threadId"');
    await runner.query('DROP TABLE agent_messages');
    await runner.query('DROP TABLE agent_threads');
  }
}
