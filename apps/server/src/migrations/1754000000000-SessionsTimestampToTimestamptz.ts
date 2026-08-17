/**
 * 将 sessions 表的时间列从 TIMESTAMP 改为 TIMESTAMP WITH TIME ZONE，
 * 与项目其他表（password_reset_tokens、documents 等）保持一致。
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionsTimestampToTimestamptz1754000000000
  implements MigrationInterface
{
  name = 'SessionsTimestampToTimestamptz1754000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "expiresAt" TYPE TIMESTAMP WITH TIME ZONE
      USING "expiresAt" AT TIME ZONE 'UTC'
    `);

    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "lastActivityAt" TYPE TIMESTAMP WITH TIME ZONE
      USING "lastActivityAt" AT TIME ZONE 'UTC'
    `);

    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE
      USING "createdAt" AT TIME ZONE 'UTC'
    `);

    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE
      USING "updatedAt" AT TIME ZONE 'UTC'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "expiresAt" TYPE TIMESTAMP
      USING "expiresAt" AT TIME ZONE 'UTC'
    `);

    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "lastActivityAt" TYPE TIMESTAMP
      USING "lastActivityAt" AT TIME ZONE 'UTC'
    `);

    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "createdAt" TYPE TIMESTAMP
      USING "createdAt" AT TIME ZONE 'UTC'
    `);

    await queryRunner.query(`
      ALTER TABLE "sessions"
      ALTER COLUMN "updatedAt" TYPE TIMESTAMP
      USING "updatedAt" AT TIME ZONE 'UTC'
    `);
  }
}
