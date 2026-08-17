/**
 * 为 sessions 表添加 refreshTokenLookup 列。
 *
 * 用途：
 * - 存储 refreshToken 的 SHA-256 哈希，替代逐条 bcrypt.compare 遍历
 * - 将 O(N) bcrypt 扫描降为 O(1) 索引定位 + 单次 bcrypt 校验
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionsAddRefreshTokenLookup1754200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
      ADD COLUMN IF NOT EXISTS "refreshTokenLookup" character varying
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sessions_refreshTokenLookup"
      ON "sessions" ("refreshTokenLookup")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessions_refreshTokenLookup"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN IF EXISTS "refreshTokenLookup"`);
  }
}
