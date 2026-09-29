/** PostgresSaver 1.0.5 的固定表结构快照；只由项目迁移建表，不在请求中运行 setup。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentCheckpoints1790121600000 implements MigrationInterface {
  name = 'CreateAgentCheckpoints1790121600000';

  /** 框架表独立 schema；归属键外键使用户/Run 清理与 Checkpoint 删除同事务完成。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_runs ADD COLUMN "checkpointKey" text
      GENERATED ALWAYS AS ("userId"::text || ':' || id::text) STORED,
      ADD CONSTRAINT "UQ_agent_runs_checkpoint_key" UNIQUE ("checkpointKey")`);
    await runner.query('CREATE SCHEMA agent_checkpoint');
    // 对齐官方 1.0.5 migrations.ts 的 0~4 版；不另造 checkpoint 格式或序列化协议。
    await runner.query('CREATE TABLE agent_checkpoint.checkpoint_migrations (v integer PRIMARY KEY)');
    await runner.query(`CREATE TABLE agent_checkpoint.checkpoints (
      thread_id text NOT NULL REFERENCES agent_runs("checkpointKey") ON DELETE CASCADE,
      checkpoint_ns text NOT NULL DEFAULT '', checkpoint_id text NOT NULL, parent_checkpoint_id text,
      type text, checkpoint jsonb NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY (thread_id,checkpoint_ns,checkpoint_id))`);
    await runner.query(`CREATE TABLE agent_checkpoint.checkpoint_blobs (
      thread_id text NOT NULL REFERENCES agent_runs("checkpointKey") ON DELETE CASCADE,
      checkpoint_ns text NOT NULL DEFAULT '', channel text NOT NULL, version text NOT NULL,
      type text NOT NULL, blob bytea, PRIMARY KEY(thread_id,checkpoint_ns,channel,version))`);
    await runner.query(`CREATE TABLE agent_checkpoint.checkpoint_writes (
      thread_id text NOT NULL REFERENCES agent_runs("checkpointKey") ON DELETE CASCADE,
      checkpoint_ns text NOT NULL DEFAULT '', checkpoint_id text NOT NULL, task_id text NOT NULL,
      idx integer NOT NULL, channel text NOT NULL, type text, blob bytea NOT NULL,
      PRIMARY KEY(thread_id,checkpoint_ns,checkpoint_id,task_id,idx))`);
    await runner.query('INSERT INTO agent_checkpoint.checkpoint_migrations(v) VALUES (0),(1),(2),(3),(4)');
  }

  /** 仅撤销本迁移创建的框架表和归属键；不级联删除未知 schema 对象。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE agent_checkpoint.checkpoint_writes, agent_checkpoint.checkpoint_blobs, agent_checkpoint.checkpoints, agent_checkpoint.checkpoint_migrations');
    await runner.query('DROP SCHEMA agent_checkpoint');
    await runner.query('ALTER TABLE agent_runs DROP CONSTRAINT "UQ_agent_runs_checkpoint_key", DROP COLUMN "checkpointKey"');
  }
}
