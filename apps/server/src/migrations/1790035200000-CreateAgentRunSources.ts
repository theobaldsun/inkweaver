/**
 * 保存 Agent Run 实际采用的知识来源快照。
 * 文档删除后仍需保留标题、片段和版本时间用于审计，因此 docId 不建立到 documents 的删除阻断外键。
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentRunSources1790035200000 implements MigrationInterface {
  name = 'CreateAgentRunSources1790035200000';

  /** 创建来源快照；同一 Run、同一文档版本及片段只保留一条来源记录。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE agent_run_sources (
      id uuid PRIMARY KEY,
      "runId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "docId" uuid NOT NULL,
      "sourceKey" varchar(160) NOT NULL,
      "retrievalKind" varchar(16) NOT NULL,
      title varchar(500) NOT NULL,
      excerpt text NOT NULL,
      "documentUpdatedAt" timestamptz NOT NULL,
      score double precision,
      "usedInContext" boolean NOT NULL DEFAULT false,
      cited boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "FK_agent_run_sources_run" FOREIGN KEY ("runId","userId")
        REFERENCES agent_runs(id,"userId") ON DELETE CASCADE,
      CONSTRAINT "UQ_agent_run_sources_key" UNIQUE ("runId","sourceKey"),
      CONSTRAINT "CHK_agent_run_sources_kind" CHECK ("retrievalKind" IN ('rag','search','tool')),
      CONSTRAINT "CHK_agent_run_sources_title" CHECK (length(btrim(title)) BETWEEN 1 AND 500),
      CONSTRAINT "CHK_agent_run_sources_excerpt" CHECK (length(excerpt) > 0),
      CONSTRAINT "CHK_agent_run_sources_score" CHECK (score IS NULL OR (score >= 0 AND score <= 1))
    )`);
    await runner.query('CREATE INDEX "IDX_agent_run_sources_user_run" ON agent_run_sources ("userId","runId","createdAt",id)');
  }

  /** 按依赖逆序撤销来源表。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE agent_run_sources');
  }
}
