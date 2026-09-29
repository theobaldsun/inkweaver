/** 证据问题随成果版本冻结；NULL 明确表示此版本没有执行结构化分析。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentArtifactEvidence1790726400000 implements MigrationInterface {
  name = 'AddAgentArtifactEvidence1790726400000';
  /** 应用层负责逐字段及引用校验，数据库限制顶层结构和大小。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_artifact_versions ADD COLUMN evidence jsonb,
      ADD CONSTRAINT "CHK_agent_artifact_evidence" CHECK (evidence IS NULL OR (
        jsonb_typeof(evidence)='object' AND evidence ?& ARRAY['schemaVersion','status','items']
        AND evidence->'schemaVersion'='1'::jsonb AND evidence->>'status'='unverified'
        AND jsonb_typeof(evidence->'items')='array' AND jsonb_array_length(evidence->'items') <= 20
        AND octet_length(evidence::text) <= 131072))`);
  }
  /** 显式降级将移除结构化分析，保留成果正文与已有引用关系。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_artifact_versions DROP CONSTRAINT "CHK_agent_artifact_evidence", DROP COLUMN evidence');
  }
}
