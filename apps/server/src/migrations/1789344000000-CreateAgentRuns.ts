/**
 * Agent Run 的持久化归属根，为后续工具调用记录提供稳定外键目标。
 * 本迁移仅创建表，不创建任务、不读取用户内容；状态转换由后续应用服务约束。
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentRuns1789344000000 implements MigrationInterface {
  name = 'CreateAgentRuns1789344000000';

  /** 创建用户归属、运行基础字段和后续乐观并发所需的修订号。 */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_runs" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL,
        "mode" varchar(16) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'CREATED',
        "goal" text NOT NULL,
        "workflowVersion" varchar(128) NOT NULL,
        "revision" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_agent_runs_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_agent_runs_id_user" UNIQUE ("id", "userId"),
        CONSTRAINT "CHK_agent_runs_mode" CHECK ("mode" IN ('dialogue', 'task')),
        CONSTRAINT "CHK_agent_runs_status" CHECK ("status" IN (
          'CREATED', 'QUEUED', 'RUNNING', 'WAITING_CONFIRMATION',
          'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'
        )),
        CONSTRAINT "CHK_agent_runs_revision" CHECK ("revision" >= 0),
        CONSTRAINT "CHK_agent_runs_goal" CHECK (length(btrim("goal")) > 0),
        CONSTRAINT "CHK_agent_runs_workflow_version" CHECK (length(btrim("workflowVersion")) > 0)
      )
    `);
    // 用户任务列表按创建时间读取；id 提供稳定的分页次序。
    await queryRunner.query('CREATE INDEX "IDX_agent_runs_user_created" ON "agent_runs" ("userId", "createdAt" DESC, "id" DESC)');
  }

  /** 仅撤销本迁移创建的表；未来存在依赖表时需先按迁移逆序撤销，不使用 CASCADE。 */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "agent_runs"');
  }
}
