/** 修订目标随 Run 固定，恢复与请求重放不得切换成果或基准版本。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentRevisionTarget1790553600000 implements MigrationInterface {
  name = 'AddAgentRevisionTarget1790553600000';
  /** 组合外键限制同用户同会话，版本外键保证基准版本真实存在。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_runs
      ADD COLUMN "revisionArtifactId" uuid,
      ADD COLUMN "revisionBaseVersion" integer,
      ADD CONSTRAINT "CHK_agent_revision_target" CHECK (
        ("revisionArtifactId" IS NULL AND "revisionBaseVersion" IS NULL) OR
        ("revisionArtifactId" IS NOT NULL AND "revisionBaseVersion" IS NOT NULL AND "revisionBaseVersion" BETWEEN 1 AND 49 AND "threadId" IS NOT NULL AND mode='task')),
      ADD CONSTRAINT "FK_agent_revision_artifact" FOREIGN KEY ("revisionArtifactId","threadId","userId") REFERENCES agent_artifacts(id,"threadId","userId"),
      ADD CONSTRAINT "FK_agent_revision_base" FOREIGN KEY ("revisionArtifactId","revisionBaseVersion") REFERENCES agent_artifact_versions("artifactId",version)`);
  }
  /** 只撤销修订目标字段，不删除历史成果版本。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_runs DROP CONSTRAINT "FK_agent_revision_base",
      DROP CONSTRAINT "FK_agent_revision_artifact", DROP CONSTRAINT "CHK_agent_revision_target",
      DROP COLUMN "revisionArtifactId", DROP COLUMN "revisionBaseVersion"`);
  }
}
