/** 模型请求在用户锁内预占上下文额度；失败、超时、崩溃均保留额度，避免未知费用被重复消费。 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentModelBudgets1790985600000 implements MigrationInterface {
  name = 'AddAgentModelBudgets1790985600000';
  /** 历史调用无法回填真实预占值，保留 null，预算计算按当前上下文上限保守计入。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE agent_model_calls ADD COLUMN "reservedTokens" integer CHECK ("reservedTokens" > 0)');
    await runner.query('CREATE INDEX "IDX_agent_model_calls_owner_day" ON agent_model_calls ("userId", "createdAt")');
  }
  /** 不改动既有调用用量事实。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX "IDX_agent_model_calls_owner_day"');
    await runner.query('ALTER TABLE agent_model_calls DROP COLUMN "reservedTokens"');
  }
}
