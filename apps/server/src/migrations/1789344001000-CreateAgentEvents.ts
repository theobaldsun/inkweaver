/**
 * Run 可见事件的持久化基础；事件正文仅允许受控摘要，不存完整工具结果或隐藏推理。
 * 本迁移不发布事件。序号分配、追加写入及与 Run 状态的事务一致性由后续服务实现。
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentEvents1789344001000 implements MigrationInterface {
  name = 'CreateAgentEvents1789344001000';

  /** 创建事件归属、顺序与版本字段；Run 内唯一序号同时支持有序回放查询。 */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_events" (
        "id" uuid PRIMARY KEY,
        "runId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "type" varchar(128) NOT NULL,
        "schemaVersion" integer NOT NULL DEFAULT 1,
        "payload" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_agent_events_run_user" FOREIGN KEY ("runId", "userId")
          REFERENCES "agent_runs"("id", "userId") ON DELETE CASCADE,
        CONSTRAINT "UQ_agent_events_run_sequence" UNIQUE ("runId", "sequence"),
        CONSTRAINT "CHK_agent_events_sequence" CHECK ("sequence" > 0),
        CONSTRAINT "CHK_agent_events_type" CHECK (length(btrim("type")) > 0),
        CONSTRAINT "CHK_agent_events_schema_version" CHECK ("schemaVersion" = 1),
        CONSTRAINT "CHK_agent_events_payload" CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    // 归属外键阻止跨用户挂载，不替代读取鉴权；唯一序号不自动保证连续或提交顺序。
    // 事件默认只追加；保留期清理允许删除。这里不使用禁止删除的触发器阻断用户清空数据。
  }

  /** 仅移除事件表，保留 Run；存在后续依赖时按迁移逆序撤销。 */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "agent_events"');
  }
}
