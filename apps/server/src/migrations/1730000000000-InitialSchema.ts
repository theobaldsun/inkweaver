/**
 * 初始 schema 基线迁移（列名与 TypeORM 实体默认 camelCase 一致）。
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1730000000000 implements MigrationInterface {
  name = 'InitialSchema1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "sessions_status_enum" AS ENUM ('active', 'expired', 'revoked');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "name" character varying,
        "avatarUrl" character varying,
        "settings" jsonb,
        "storageUsedBytes" bigint NOT NULL DEFAULT 0,
        "storageQuotaBytes" bigint NOT NULL DEFAULT 10737418240,
        "storageCalculatedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "refreshTokenHash" character varying NOT NULL,
        "deviceType" character varying,
        "deviceName" character varying,
        "os" character varying,
        "browser" character varying,
        "ipAddress" character varying,
        "status" "sessions_status_enum" NOT NULL DEFAULT 'active',
        "expiresAt" TIMESTAMP NOT NULL,
        "lastActivityAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sessions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "folders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "parentId" character varying,
        "description" character varying,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_folders" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "content" text NOT NULL,
        "isPublic" boolean NOT NULL DEFAULT false,
        "shareLink" character varying,
        "tags" jsonb,
        "folderId" character varying,
        "userId" uuid NOT NULL,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "deletedFromFolderId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_documents" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sync_update" (
        "updateId" SERIAL NOT NULL,
        "docId" character varying NOT NULL,
        "update" text NOT NULL,
        "timestamp" bigint NOT NULL,
        "clientId" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_update" PRIMARY KEY ("updateId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sync_update_docId_createdAt"
        ON "sync_update" ("docId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sync_update_docId"
        ON "sync_update" ("docId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "doc_snapshot" (
        "id" SERIAL NOT NULL,
        "docId" character varying NOT NULL,
        "snapshot" text NOT NULL,
        "version" bigint NOT NULL DEFAULT 0,
        "updateCount" bigint NOT NULL DEFAULT 0,
        "size" bigint,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_doc_snapshot" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_doc_snapshot_docId" UNIQUE ("docId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "search_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "keyword" character varying(255) NOT NULL,
        "count" integer NOT NULL DEFAULT 1,
        "userId" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_search_history" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "type" character varying(64) NOT NULL,
        "title" character varying(255) NOT NULL,
        "body" text NOT NULL,
        "metadata" jsonb,
        "readAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tokenHash" character varying(128) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "usedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "password_reset_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "search_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "doc_snapshot"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_update"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "folders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "sessions_status_enum"`);
  }
}
