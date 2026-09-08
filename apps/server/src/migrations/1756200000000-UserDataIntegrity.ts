/**
 * 用户派生数据完整性约束。
 *
 * 清理历史孤儿与重复搜索记录后，补充级联外键和搜索历史唯一索引，确保注销与并发
 * 写入不会再次产生不可追踪的残留数据。
 */
import { MigrationInterface, QueryRunner } from "typeorm";

export class UserDataIntegrity1756200000000 implements MigrationInterface {
  name = "UserDataIntegrity1756200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "search_history" newer
      USING "search_history" older
      WHERE newer."userId" = older."userId"
        AND newer.keyword = older.keyword
        AND (newer."updatedAt", newer.id) < (older."updatedAt", older.id)
    `);
    await queryRunner.query(`
      DELETE FROM "document_chunks" c
      WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = c."docId")
         OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c."userId")
    `);
    await queryRunner.query(`
      DELETE FROM "sync_update" s
      WHERE NOT EXISTS (
        SELECT 1 FROM documents d
        JOIN users u ON u.id = d."userId"
        WHERE d.id::text = s."docId"
      )
    `);
    await queryRunner.query(`
      DELETE FROM "doc_snapshot" s
      WHERE NOT EXISTS (
        SELECT 1 FROM documents d
        JOIN users u ON u.id = d."userId"
        WHERE d.id::text = s."docId"
      )
    `);
    await queryRunner.query(`
      DELETE FROM documents d
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d."userId")
    `);
    await queryRunner.query(`
      DELETE FROM folders f
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f."userId")
    `);
    await queryRunner.query(`
      DELETE FROM search_history h
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id::text = h."userId")
    `);
    await queryRunner.query(`
      DELETE FROM sessions s
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s."userId")
    `);
    await queryRunner.query(`
      DELETE FROM notifications n
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n."userId")
    `);
    await queryRunner.query(`
      DELETE FROM password_reset_tokens t
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t."userId")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_search_history_user_keyword"
      ON "search_history" ("userId", keyword)
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "document_chunks"
          ADD CONSTRAINT "FK_document_chunks_document"
          FOREIGN KEY ("docId") REFERENCES documents(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "document_chunks"
          ADD CONSTRAINT "FK_document_chunks_user"
          FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE notifications
          ADD CONSTRAINT "FK_notifications_user"
          FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE password_reset_tokens
          ADD CONSTRAINT "FK_password_reset_tokens_user"
          FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS "FK_password_reset_tokens_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS "FK_notifications_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "FK_document_chunks_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "FK_document_chunks_document"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_search_history_user_keyword"`);
  }
}
