/**
 * 一次逻辑工具调用的持久化基础；具体执行尝试另表保存。
 * 参数属于私人数据，表结构不能证明 Schema/权限已通过；开放写入前必须接入校验与导出。
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentToolCalls1789430401000 implements MigrationInterface {
  name = 'CreateAgentToolCalls1789430401000';

  /** 创建归属、调用去重及生命周期字段；去重键不等同于外部写入幂等保证。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "agent_tool_calls" (
      "id" uuid PRIMARY KEY,
      "runId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "callKey" varchar(128) NOT NULL CHECK (length(btrim("callKey")) > 0),
      "toolName" text NOT NULL CHECK (length(btrim("toolName")) > 0),
      "toolVersion" text NOT NULL CHECK (length(btrim("toolVersion")) > 0),
      "originKind" varchar(16) NOT NULL,
      "connectionId" text,
      "input" jsonb NOT NULL CHECK (jsonb_typeof("input") = 'object'),
      "status" varchar(32) NOT NULL DEFAULT 'PREPARED',
      "sideEffect" varchar(16) NOT NULL DEFAULT 'none' CHECK ("sideEffect" IN ('none', 'committed', 'unknown')),
      "attemptCount" integer NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
      "requiresConfirmation" boolean NOT NULL,
      "cancelRequested" boolean NOT NULL DEFAULT false,
      "revision" integer NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FK_agent_tool_calls_run_user" FOREIGN KEY ("runId", "userId")
        REFERENCES "agent_runs" ("id", "userId") ON DELETE CASCADE,
      CONSTRAINT "UQ_agent_tool_calls_run_key" UNIQUE ("runId", "callKey"),
      CONSTRAINT "CHK_agent_tool_calls_origin" CHECK (
        ("originKind" = 'builtin' AND "connectionId" IS NULL) OR
        ("originKind" = 'mcp' AND "connectionId" IS NOT NULL AND length(btrim("connectionId")) > 0)
      ),
      CONSTRAINT "CHK_agent_tool_calls_status" CHECK ("status" IN (
        'PREPARED', 'WAITING_CONFIRMATION', 'READY', 'EXECUTING', 'RETRY_WAIT',
        'OUTCOME_UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'
      ))
    )`);
    // 按 Run 查询待处理调用；恢复全局队列的索引在调度查询确定后追加。
    await runner.query('CREATE INDEX "IDX_agent_tool_calls_run_status" ON "agent_tool_calls" ("runId", "status")');
  }

  /** 撤销本表；未来存在执行尝试表时必须先按迁移逆序撤销依赖。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE "agent_tool_calls"');
  }
}
