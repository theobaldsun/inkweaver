/** 成果归属会话，版本归属生成它的 Run；正文与引用只追加，不覆盖历史。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentArtifacts1790467200000 implements MigrationInterface {
  name = 'CreateAgentArtifacts1790467200000';

  /** 三张表一起建立，组合外键约束用户、会话、Run 和来源归属。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_runs ADD CONSTRAINT "UQ_agent_run_thread_owner" UNIQUE (id,"threadId","userId")');
    await runner.query('ALTER TABLE agent_run_sources ADD CONSTRAINT "UQ_agent_source_run_owner" UNIQUE (id,"runId","userId")');
    await runner.query(`CREATE TABLE agent_artifacts (
      id uuid PRIMARY KEY, "threadId" uuid NOT NULL, "userId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "UQ_agent_artifact_owner" UNIQUE (id,"threadId","userId"),
      CONSTRAINT "FK_agent_artifact_thread" FOREIGN KEY ("threadId","userId") REFERENCES agent_threads(id,"userId") ON DELETE CASCADE
    )`);
    await runner.query('CREATE INDEX "IDX_agent_artifact_thread" ON agent_artifacts ("userId","threadId")');
    await runner.query(`CREATE TABLE agent_artifact_versions (
      id uuid PRIMARY KEY, "artifactId" uuid NOT NULL, "threadId" uuid NOT NULL,
      "userId" uuid NOT NULL, "runId" uuid NOT NULL,
      version integer NOT NULL CHECK (version BETWEEN 1 AND 50),
      kind varchar(16) NOT NULL CHECK (kind IN ('outline','draft')),
      title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
      content text NOT NULL CHECK (length(btrim(content)) > 0 AND octet_length(content) <= 262144),
      digest char(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "UQ_agent_artifact_version" UNIQUE ("artifactId",version),
      CONSTRAINT "UQ_agent_artifact_version_owner" UNIQUE (id,"runId","userId"),
      CONSTRAINT "FK_agent_artifact_version_parent" FOREIGN KEY ("artifactId","threadId","userId") REFERENCES agent_artifacts(id,"threadId","userId") ON DELETE CASCADE,
      CONSTRAINT "FK_agent_artifact_version_run" FOREIGN KEY ("runId","threadId","userId") REFERENCES agent_runs(id,"threadId","userId") ON DELETE CASCADE
    )`);
    await runner.query('CREATE INDEX "IDX_agent_artifact_version_run" ON agent_artifact_versions ("runId","userId")');
    await runner.query(`CREATE TABLE agent_artifact_sources (
      "versionId" uuid NOT NULL, "sourceId" uuid NOT NULL, "runId" uuid NOT NULL, "userId" uuid NOT NULL,
      label varchar(16) NOT NULL CHECK (label ~ '^S[1-9][0-9]*$'),
      PRIMARY KEY ("versionId",label), UNIQUE ("versionId","sourceId"),
      CONSTRAINT "FK_agent_artifact_source_version" FOREIGN KEY ("versionId","runId","userId") REFERENCES agent_artifact_versions(id,"runId","userId") ON DELETE CASCADE,
      CONSTRAINT "FK_agent_artifact_source_snapshot" FOREIGN KEY ("sourceId","runId","userId") REFERENCES agent_run_sources(id,"runId","userId") ON DELETE CASCADE
    )`);
    await runner.query('CREATE INDEX "IDX_agent_artifact_source_snapshot" ON agent_artifact_sources ("sourceId","runId","userId")');
  }

  /** 仅提供显式回滚，按依赖逆序撤销；不会在应用启动时自动执行。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE agent_artifact_sources');
    await runner.query('DROP TABLE agent_artifact_versions');
    await runner.query('DROP TABLE agent_artifacts');
    await runner.query('ALTER TABLE agent_run_sources DROP CONSTRAINT "UQ_agent_source_run_owner"');
    await runner.query('ALTER TABLE agent_runs DROP CONSTRAINT "UQ_agent_run_thread_owner"');
  }
}
