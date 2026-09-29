/** 持久化调度与取消意图；模型错误暂停等待人工重试，不依赖进程内队列保存任务。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentDispatch1791072000000 implements MigrationInterface {
  name = 'AddAgentDispatch1791072000000';
  /** 旧内部 Run 默认暂停，不能在首次接通 Worker 时自动发送历史私人资料。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_runs ADD COLUMN "executionPaused" boolean NOT NULL DEFAULT true,
      ADD COLUMN "cancelRequested" boolean NOT NULL DEFAULT false,
      ADD COLUMN "lastErrorCode" varchar(64),
      ADD COLUMN "nextDispatchAt" timestamptz NOT NULL DEFAULT clock_timestamp()`);
    await runner.query(`CREATE INDEX "IDX_agent_runs_dispatch" ON agent_runs ("nextDispatchAt")
      WHERE "executionPaused"=false AND status IN ('CREATED','QUEUED','RUNNING','WAITING_CONFIRMATION')`);
  }
  /** 撤销调度元数据，不删除业务运行历史。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX "IDX_agent_runs_dispatch"');
    await runner.query('ALTER TABLE agent_runs DROP COLUMN "executionPaused", DROP COLUMN "cancelRequested", DROP COLUMN "lastErrorCode", DROP COLUMN "nextDispatchAt"');
  }
}
