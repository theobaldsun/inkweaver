/** Agent 内容配额及保存后的索引投递事实；不改变既有文档编辑的配额策略。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentStorageAndIndexing1791158400000 implements MigrationInterface {
  name = 'AddAgentStorageAndIndexing1791158400000';
  /** 按用户聚合逻辑存储字节；包括已删除但尚未清理的历史，非 PostgreSQL 物理磁盘占用。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_document_saves ADD COLUMN "indexScheduledAt" timestamptz');
    const tables = ['agent_threads', 'agent_messages', 'agent_runs', 'agent_events', 'agent_tool_calls', 'agent_tool_attempts',
      'agent_confirmations', 'agent_run_sources', 'agent_model_calls', 'agent_artifacts', 'agent_artifact_versions', 'agent_artifact_sources', 'agent_document_saves'];
    const parts = tables.map((table) => `SELECT COALESCE(sum(octet_length(to_jsonb(t)::text)),0) AS bytes FROM ${table} t WHERE t."userId"=owner`);
    parts.push(`SELECT COALESCE(sum(octet_length(to_jsonb(t)::text)),0) FROM agent_tool_results t JOIN agent_tool_attempts a ON a.id=t."attemptId" WHERE a."userId"=owner`);
    for (const table of ['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']) {
      parts.push(`SELECT COALESCE(sum(octet_length(to_jsonb(t)::text)),0) FROM agent_checkpoint.${table} t JOIN agent_runs r ON r."checkpointKey"=t.thread_id WHERE r."userId"=owner`);
    }
    await runner.query(`CREATE FUNCTION agent_storage_bytes(owner uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
      SELECT COALESCE(sum(bytes),0)::bigint FROM (${parts.join(' UNION ALL ')}) usage $$`);
    await runner.query(`CREATE FUNCTION agent_check_storage(owner uuid) RETURNS void LANGUAGE plpgsql AS $$
      DECLARE quota bigint; used bigint;
      BEGIN
        SELECT "storageQuotaBytes" INTO quota FROM users WHERE id=owner FOR UPDATE;
        IF quota IS NULL THEN RAISE EXCEPTION 'AGENT_OWNER_UNAVAILABLE'; END IF;
        SELECT agent_storage_bytes(owner)
          + COALESCE((SELECT sum(octet_length(COALESCE(title,''))+octet_length(COALESCE(content,''))) FROM documents WHERE "userId"=owner),0)
          + COALESCE((SELECT sum(octet_length(s.snapshot)) FROM doc_snapshot s JOIN documents d ON d.id=s."docId"::uuid WHERE d."userId"=owner),0)
          + COALESCE((SELECT sum(octet_length(s.update)) FROM sync_update s JOIN documents d ON d.id=s."docId"::uuid WHERE d."userId"=owner),0)
          INTO used;
        IF used>quota THEN RAISE EXCEPTION 'AGENT_STORAGE_QUOTA_EXCEEDED'; END IF;
      END $$`);
    await runner.query(`CREATE FUNCTION agent_content_quota_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE owner uuid;
      BEGIN
        IF TG_TABLE_SCHEMA='agent_checkpoint' THEN
          SELECT "userId" INTO owner FROM agent_runs WHERE "checkpointKey"=NEW.thread_id;
        ELSIF TG_TABLE_NAME='agent_tool_results' THEN
          SELECT "userId" INTO owner FROM agent_tool_attempts WHERE id=NEW."attemptId";
        ELSE owner:=NEW."userId"; END IF;
        PERFORM agent_check_storage(owner);
        RETURN NEW;
      END $$`);
    for (const table of ['agent_messages', 'agent_run_sources', 'agent_artifact_versions', 'agent_tool_results',
      'agent_checkpoint.checkpoints', 'agent_checkpoint.checkpoint_blobs', 'agent_checkpoint.checkpoint_writes']) {
      await runner.query(`CREATE TRIGGER agent_content_quota AFTER INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION agent_content_quota_trigger()`);
    }
  }
  /** 仅移除本模块配额触发器、函数和投递标记。 */
  async down(runner: QueryRunner): Promise<void> {
    for (const table of ['agent_messages', 'agent_run_sources', 'agent_artifact_versions', 'agent_tool_results',
      'agent_checkpoint.checkpoints', 'agent_checkpoint.checkpoint_blobs', 'agent_checkpoint.checkpoint_writes']) {
      await runner.query(`DROP TRIGGER agent_content_quota ON ${table}`);
    }
    await runner.query('DROP FUNCTION agent_content_quota_trigger(), agent_check_storage(uuid), agent_storage_bytes(uuid)');
    await runner.query('ALTER TABLE agent_document_saves DROP COLUMN "indexScheduledAt"');
  }
}
