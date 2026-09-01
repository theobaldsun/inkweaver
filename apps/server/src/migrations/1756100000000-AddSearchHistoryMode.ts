/**
 * 搜索历史表新增 mode 列：记录该关键词最后一次使用的搜索模式（smart/keyword/semantic）。
 * 用于点击历史项时跳回对应模式，以及前端展示模式徽章。
 *
 * 兼容策略：存量记录 DEFAULT 'smart'，不会因非空约束导致迁移失败。
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSearchHistoryMode1756100000000 implements MigrationInterface {
  name = 'AddSearchHistoryMode1756100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE search_history ADD COLUMN IF NOT EXISTS "mode" varchar(20) NOT NULL DEFAULT 'smart'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE search_history DROP COLUMN IF EXISTS "mode"`);
  }
}
