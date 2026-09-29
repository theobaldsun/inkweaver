/** 为事件分配持久化高水位；清理历史事件后也不能复用旧序号。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentEventSequence1789430400000 implements MigrationInterface {
  name = 'AddAgentEventSequence1789430400000';

  /** 加列并从已有事件初始化；迁移必须在事务中执行。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "agent_runs" ADD COLUMN "lastEventSequence" integer NOT NULL DEFAULT 0 CHECK ("lastEventSequence" >= 0)');
    await runner.query(`UPDATE "agent_runs" r SET "lastEventSequence" = e.maximum
      FROM (SELECT "runId", MAX("sequence") AS maximum FROM "agent_events" GROUP BY "runId") e
      WHERE r.id = e."runId"`);
  }

  /** 回退前应停止事件写入服务；仅移除计数器，不删除事件。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "agent_runs" DROP COLUMN "lastEventSequence"');
  }
}
