/** 工具来源绑定已提交调用及内容版本；工具没有文档更新时间时保留 null，不伪造时间。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentToolSources1790380800000 implements MigrationInterface {
  name = 'AddAgentToolSources1790380800000';
  /** 来源与 Call 组合归属外键；同一调用最多一个来源。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_run_sources
      ALTER COLUMN "documentUpdatedAt" DROP NOT NULL,
      ADD COLUMN "toolCallId" uuid,
      ADD COLUMN "documentVersion" varchar(64),
      ADD CONSTRAINT "UQ_agent_source_tool_call" UNIQUE ("toolCallId"),
      ADD CONSTRAINT "FK_agent_source_tool_call" FOREIGN KEY ("toolCallId","runId","userId")
        REFERENCES agent_tool_calls(id,"runId","userId") ON DELETE CASCADE,
      ADD CONSTRAINT "CHK_agent_source_tool_version" CHECK (
        ("toolCallId" IS NULL AND "documentVersion" IS NULL) OR
        ("toolCallId" IS NOT NULL AND "documentVersion" IS NOT NULL AND "documentVersion" ~ '^[0-9a-f]{64}$' AND "retrievalKind"='tool'))`);
  }
  /** 有缺失时间的历史时明确阻止降级，不能为了回滚伪造文档版本时间。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_run_sources ALTER COLUMN "documentUpdatedAt" SET NOT NULL');
    await runner.query(`ALTER TABLE agent_run_sources DROP CONSTRAINT "CHK_agent_source_tool_version",
      DROP CONSTRAINT "FK_agent_source_tool_call", DROP CONSTRAINT "UQ_agent_source_tool_call",
      DROP COLUMN "toolCallId", DROP COLUMN "documentVersion"`);
  }
}
