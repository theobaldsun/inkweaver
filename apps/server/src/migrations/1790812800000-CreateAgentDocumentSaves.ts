/** Agent 文档保存绑定：先固定成果版本与目标 ID，不在此迁移创建任何用户文档。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentDocumentSaves1790812800000 implements MigrationInterface {
  name = 'CreateAgentDocumentSaves1790812800000';
  /** 一份成果版本首版仅允许绑定一次保存，换请求键也不能重复生成文档。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_artifact_versions ADD CONSTRAINT "UQ_agent_version_thread_owner" UNIQUE (id,"threadId","userId")');
    await runner.query(`CREATE TABLE agent_document_saves (
      id uuid PRIMARY KEY, "userId" uuid NOT NULL, "threadId" uuid NOT NULL, "runId" uuid NOT NULL,
      "artifactVersionId" uuid NOT NULL, "requestKey" varchar(128) NOT NULL,
      "documentId" uuid NOT NULL UNIQUE, "folderId" uuid, digest char(64) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','SAVED')),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "savedAt" timestamptz,
      CONSTRAINT "UQ_agent_save_request" UNIQUE ("userId","runId","requestKey"),
      CONSTRAINT "UQ_agent_save_version" UNIQUE ("artifactVersionId"),
      CONSTRAINT "CHK_agent_save_key" CHECK (length(btrim("requestKey")) BETWEEN 1 AND 128),
      CONSTRAINT "CHK_agent_save_digest" CHECK (digest ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CHK_agent_save_state" CHECK ((status='SAVED') = ("savedAt" IS NOT NULL)),
      CONSTRAINT "FK_agent_save_run" FOREIGN KEY ("runId","threadId","userId") REFERENCES agent_runs(id,"threadId","userId") ON DELETE CASCADE,
      CONSTRAINT "FK_agent_save_version" FOREIGN KEY ("artifactVersionId","threadId","userId") REFERENCES agent_artifact_versions(id,"threadId","userId") ON DELETE CASCADE
    )`);
    // 文档尚未创建；目标 ID 保留去重身份，不能以文档不存在就自动换 ID 重建。
    await runner.query('CREATE INDEX "IDX_agent_save_user" ON agent_document_saves ("userId","createdAt",id)');
  }
  /** 显式回滚保存绑定结构；不删除任何用户文档。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE agent_document_saves');
    await runner.query('ALTER TABLE agent_artifact_versions DROP CONSTRAINT "UQ_agent_version_thread_owner"');
  }
}
