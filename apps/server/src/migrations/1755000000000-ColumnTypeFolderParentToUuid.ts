/**
 * 统一 folders / documents 表中关联列的类型为 uuid。
 *
 * 背景：
 * - folders.id 是 uuid，但 folders.parentId 与 documents.folderId 建表时为 character varying
 * - 类型不一致导致无法建立外键约束，JOIN 时需显式 cast，索引无法直接利用
 *
 * 策略：
 * - 使用 `ALTER COLUMN ... TYPE uuid USING ...::uuid` 原地转换
 * - 转换前校验所有非空值均为合法 UUID，若存在脏数据会在迁移时失败并暴露问题
 * - 迁移仅影响列类型，不改变业务逻辑；实体层同步更新为 uuid 类型
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class ColumnTypeFolderParentToUuid1755000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // folders.parentId: character varying → uuid
    await queryRunner.query(`
      ALTER TABLE "folders"
      ALTER COLUMN "parentId" TYPE uuid
      USING "parentId"::uuid
    `);

    // documents.folderId: character varying → uuid
    await queryRunner.query(`
      ALTER TABLE "documents"
      ALTER COLUMN "folderId" TYPE uuid
      USING "folderId"::uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
      ALTER COLUMN "folderId" TYPE character varying
      USING "folderId"::character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "folders"
      ALTER COLUMN "parentId" TYPE character varying
      USING "parentId"::character varying
    `);
  }
}
