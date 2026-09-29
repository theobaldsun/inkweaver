/** 将上下文引用标签保留为业务事实，Checkpoint 清理后仍能解释可见回答。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentSourceCitationLabels1790208000000 implements MigrationInterface {
  name = 'AddAgentSourceCitationLabels1790208000000';
  /** 旧来源没有可靠标签，保持 null，不按创建顺序猜测补写。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_run_sources ADD COLUMN "citationLabel" varchar(16),
      ADD CONSTRAINT "CHK_agent_source_citation_label" CHECK ("citationLabel" IS NULL OR "citationLabel" ~ '^S[1-9][0-9]*$'),
      ADD CONSTRAINT "UQ_agent_source_citation_label" UNIQUE ("runId","citationLabel")`);
  }
  /** 撤销标签约束和列，不删除来源快照。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_run_sources DROP CONSTRAINT "UQ_agent_source_citation_label", DROP CONSTRAINT "CHK_agent_source_citation_label", DROP COLUMN "citationLabel"');
  }
}
