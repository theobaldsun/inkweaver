/** 绑定保存成功的工具调用，并区分原子数据库写入与事务外只读执行的预算记录。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentDocumentSaveCommit1790899200000 implements MigrationInterface {
  name = 'AddAgentDocumentSaveCommit1790899200000';
  /** 保存、文档与调用结果将由同一事务提交。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_document_saves ADD COLUMN "savedCallId" uuid,
      ADD CONSTRAINT "UQ_agent_save_call" UNIQUE ("savedCallId"),
      ADD CONSTRAINT "FK_agent_save_call" FOREIGN KEY ("savedCallId","runId","userId") REFERENCES agent_tool_calls(id,"runId","userId"),
      ADD CONSTRAINT "CHK_agent_save_call" CHECK ((status='SAVED') = ("savedCallId" IS NOT NULL))`);
    await runner.query(`ALTER TABLE agent_budget_reservations DROP CONSTRAINT "agent_budget_reservations_executionKind_check",
      ADD CONSTRAINT "agent_budget_reservations_executionKind_check" CHECK ("executionKind" IN ('legacy_unknown','builtin_read','builtin_write_atomic'))`);
  }
  /** 有已提交写入时保留事实，不能静默把写预算降级为只读。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agent_budget_reservations DROP CONSTRAINT "agent_budget_reservations_executionKind_check",
      ADD CONSTRAINT "agent_budget_reservations_executionKind_check" CHECK ("executionKind" IN ('legacy_unknown','builtin_read'))`);
    await runner.query(`ALTER TABLE agent_document_saves DROP CONSTRAINT "CHK_agent_save_call", DROP CONSTRAINT "FK_agent_save_call",
      DROP CONSTRAINT "UQ_agent_save_call", DROP COLUMN "savedCallId"`);
  }
}
