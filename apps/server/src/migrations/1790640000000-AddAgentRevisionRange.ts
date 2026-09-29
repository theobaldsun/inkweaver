/** 保存章节修订范围，并让新 Run 保留旧来源标签及可追溯的快照继承关系。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentRevisionRange1790640000000 implements MigrationInterface {
  name = 'AddAgentRevisionRange1790640000000';
  /** 范围只能用于已绑定成果的章节修订 Run；继承来源不能跨用户。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_runs ADD COLUMN "revisionRange" jsonb,
      ADD CONSTRAINT "CHK_agent_revision_range" CHECK ("revisionRange" IS NULL OR (
        "revisionArtifactId" IS NOT NULL AND "workflowVersion"='agent-section-v1'
        AND jsonb_typeof("revisionRange")='object'
        AND "revisionRange" ?& ARRAY['start','end'] AND ("revisionRange" - 'start' - 'end')='{}'::jsonb
        AND jsonb_typeof("revisionRange"->'start')='number' AND jsonb_typeof("revisionRange"->'end')='number'
        AND ("revisionRange"->>'start') ~ '^[0-9]{1,6}$' AND ("revisionRange"->>'end') ~ '^[0-9]{1,6}$'
        AND ("revisionRange"->>'start')::integer < ("revisionRange"->>'end')::integer
        AND ("revisionRange"->>'end')::integer <= 262144))`);
    await runner.query(`ALTER TABLE agent_run_sources
      ADD COLUMN "inheritedFromSourceId" uuid,
      ADD CONSTRAINT "UQ_agent_source_owner" UNIQUE (id,"userId"),
      ADD CONSTRAINT "FK_agent_source_inherited" FOREIGN KEY ("inheritedFromSourceId","userId") REFERENCES agent_run_sources(id,"userId"),
      DROP CONSTRAINT "CHK_agent_run_sources_kind",
      ADD CONSTRAINT "CHK_agent_run_sources_kind" CHECK ("retrievalKind" IN ('rag','search','tool','revision')),
      ADD CONSTRAINT "CHK_agent_source_inherited" CHECK (("retrievalKind"='revision') = ("inheritedFromSourceId" IS NOT NULL))`);
  }
  /** 已有继承来源时拒绝丢弃来源追踪；由操作方先处理业务数据再降级。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_run_sources DROP CONSTRAINT "CHK_agent_run_sources_kind",
      ADD CONSTRAINT "CHK_agent_run_sources_kind" CHECK ("retrievalKind" IN ('rag','search','tool'))`);
    await runner.query(`ALTER TABLE agent_run_sources DROP CONSTRAINT "CHK_agent_source_inherited",
      DROP CONSTRAINT "FK_agent_source_inherited", DROP CONSTRAINT "UQ_agent_source_owner", DROP COLUMN "inheritedFromSourceId"`);
    await runner.query('ALTER TABLE agent_runs DROP CONSTRAINT "CHK_agent_revision_range", DROP COLUMN "revisionRange"');
  }
}
