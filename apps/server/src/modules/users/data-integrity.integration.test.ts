/**
 * PostgreSQL 数据完整性集成测试。
 * 覆盖迁移回滚、Refresh Token 并发轮换、密码重置原子消费和账户数据清理。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";

import { User } from "./entity/user.entity";
import { UserDataService } from "./user-data.service";
import { DocumentChunk } from "../ai/entity/document-chunk.entity";
import { AuthPasswordController } from "../auth/auth-password.controller";
import { Session, SessionStatus } from "../auth/entity/session.entity";
import { SessionService } from "../auth/session.service";
import { PasswordResetToken } from "./entity/password-reset-token.entity";
import { Document } from "../documents/entity/document.entity";
import { Folder } from "../documents/entity/folder.entity";
import { Notification } from "../notifications/notification.entity";
import { SearchHistory } from "../search/entity/search-history.entity";
import { ObjectStorageService } from "../storage/object-storage.service";
import { DocSnapshot } from "../sync/entity/doc-snapshot.entity";
import { SyncUpdate } from "../sync/entity/sync-update.entity";

const shouldRun = process.env.RUN_INTEGRATION_TESTS === "1";
const userId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const orphanUserId = "33333333-3333-4333-8333-333333333333";
const orphanDocumentId = "44444444-4444-4444-8444-444444444444";

const dataSource = new DataSource({
  type: "postgres",
  host: "127.0.0.1",
  port: 5433,
  username: "inkweaver_test",
  password: "inkweaver_test",
  database: "syncbox_test",
  entities: [
    User,
    Session,
    Document,
    Folder,
    SearchHistory,
    SyncUpdate,
    DocSnapshot,
    PasswordResetToken,
    DocumentChunk,
    Notification,
  ],
  migrations: [join(__dirname, "..", "..", "migrations", "*.js")],
  synchronize: false,
});

test("迁移、认证并发与账户清理形成完整闭环", { skip: !shouldRun }, async () => {
  const minioConfig = {
    endpoint: "http://127.0.0.1:9002",
    region: "us-east-1",
    credentials: {
      accessKeyId: "inkweaver_test",
      secretAccessKey: "inkweaver_test_secret",
    },
    forcePathStyle: true,
  };
  const s3 = new S3Client(minioConfig);
  try {
    await s3.send(new CreateBucketCommand({ Bucket: "inkweaver-test" }));
  } catch (error) {
    if ((error as { name?: string }).name !== "BucketAlreadyOwnedByYou") throw error;
  }
  const objectStorage = new ObjectStorageService(
    new ConfigService({
      MINIO_ENDPOINT: minioConfig.endpoint,
      MINIO_ACCESS_KEY: minioConfig.credentials.accessKeyId,
      MINIO_SECRET_KEY: minioConfig.credentials.secretAccessKey,
      MINIO_BUCKET: "inkweaver-test",
    }),
  );

  await dataSource.initialize();
  try {
    await dataSource.dropDatabase();
    const migrations = await dataSource.runMigrations({ transaction: "all" });
    assert.ok(migrations.some((migration) => migration.name === "UserDataIntegrity1756200000000"));
    await dataSource.undoLastMigration({ transaction: "all" });
    await dataSource.query(
      `INSERT INTO documents (id, title, content, "userId", "isPublic", "createdAt", "updatedAt")
       VALUES ($1, 'orphan', 'orphan', $2, false, NOW(), NOW())`,
      [orphanDocumentId, orphanUserId],
    );
    await dataSource.query(
      `INSERT INTO sync_update ("docId", update, timestamp, "clientId")
       VALUES ($1, 'AA==', 1, 'legacy')`,
      [orphanDocumentId],
    );
    await dataSource.query(
      `INSERT INTO doc_snapshot ("docId", snapshot, version, "updateCount")
       VALUES ($1, 'AA==', 1, 1)`,
      [orphanDocumentId],
    );
    await dataSource.query(
      `INSERT INTO folders (name, "userId", "createdAt", "updatedAt")
       VALUES ('orphan', $1, NOW(), NOW())`,
      [orphanUserId],
    );
    await dataSource.query(
      `INSERT INTO search_history ("userId", keyword, count, mode)
       VALUES ($1, 'orphan', 1, 'smart')`,
      [orphanUserId],
    );
    const replayed = await dataSource.runMigrations({ transaction: "all" });
    assert.equal(replayed.at(-1)?.name, "UserDataIntegrity1756200000000");
    for (const table of ["documents", "folders", "search_history", "sync_update", "doc_snapshot"]) {
      const [{ count }] = await dataSource.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      assert.equal(Number(count), 0, `${table} 的旧版孤儿数据应被清理`);
    }

    const users = dataSource.getRepository(User);
    const sessions = dataSource.getRepository(Session);
    const resetTokens = dataSource.getRepository(PasswordResetToken);
    await users.save(
      users.create({
        id: userId,
        email: "integration@example.test",
        password: "old-password-hash",
        name: "Integration",
        avatarUrl: `/uploads/avatars/${userId}.png`,
        settings: null,
      }),
    );

    const sessionService = new SessionService(sessions);
    await sessionService.createSession({
      user: await users.findOneByOrFail({ id: userId }),
      refreshToken: "refresh-old",
    });
    const concurrent = await Promise.allSettled([
      sessionService.rotateRefreshToken("refresh-old", userId, "refresh-new-a"),
      sessionService.rotateRefreshToken("refresh-old", userId, "refresh-new-b"),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    const winningToken = concurrent[0]?.status === "fulfilled" ? "refresh-new-a" : "refresh-new-b";
    await assert.rejects(() => sessionService.validateRefreshToken("refresh-old", userId));
    await sessionService.rotateRefreshToken(winningToken, userId, "refresh-next");
    await sessionService.validateRefreshToken("refresh-next", userId);

    await resetTokens.save(
      resetTokens.create({
        userId,
        tokenHash: "7c18b43a1d8227cddb332e67971e790ce35ac2303f4fccfb2a565622f2fe1cec",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      }),
    );
    const passwordController = new AuthPasswordController({} as never, {} as never, resetTokens);
    const resetResults = await Promise.all([
      passwordController.resetPassword({ token: "reset-token", passwordHash: "a".repeat(64) }),
      passwordController.resetPassword({ token: "reset-token", passwordHash: "b".repeat(64) }),
    ]);
    assert.equal(resetResults.filter((result) => result.success).length, 1);
    assert.equal((await sessions.findOneByOrFail({ userId })).status, SessionStatus.REVOKED);

    const rollbackToken = "reset-rollback-token";
    const rollbackTokenHash = createHash("sha256").update(rollbackToken).digest("hex");
    await resetTokens.save(
      resetTokens.create({
        userId,
        tokenHash: rollbackTokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      }),
    );
    await sessions.update({ userId }, { status: SessionStatus.ACTIVE });
    const passwordBeforeRollback = (await users.findOneByOrFail({ id: userId })).password;
    await dataSource.query(`
      CREATE OR REPLACE FUNCTION integration_fail_session_update()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected session update failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER integration_fail_session_update_trigger
      BEFORE UPDATE ON sessions
      FOR EACH ROW EXECUTE FUNCTION integration_fail_session_update()
    `);
    try {
      await assert.rejects(() =>
        passwordController.resetPassword({
          token: rollbackToken,
          passwordHash: "c".repeat(64),
        }),
      );
    } finally {
      await dataSource.query("DROP TRIGGER integration_fail_session_update_trigger ON sessions");
      await dataSource.query("DROP FUNCTION integration_fail_session_update()");
    }
    assert.equal((await users.findOneByOrFail({ id: userId })).password, passwordBeforeRollback);
    assert.equal(
      (await resetTokens.findOneByOrFail({ tokenHash: rollbackTokenHash })).usedAt,
      null,
    );
    assert.equal((await sessions.findOneByOrFail({ userId })).status, SessionStatus.ACTIVE);

    const vector = `[${Array.from({ length: 512 }, () => "0").join(",")}]`;
    await dataSource.query(
      `INSERT INTO documents (id, title, content, "userId", "isPublic", "createdAt", "updatedAt")
       VALUES ($1, 'doc', 'content', $2, false, NOW(), NOW())`,
      [documentId, userId],
    );
    await dataSource.query(
      `INSERT INTO document_chunks ("userId", "docId", "chunkIndex", content, title, embedding)
       VALUES ($1, $2, 0, 'chunk', 'doc', $3::vector)`,
      [userId, documentId, vector],
    );
    await dataSource.query(
      `INSERT INTO notifications ("userId", type, title, body) VALUES ($1, 'test', 'test', 'test')`,
      [userId],
    );
    await dataSource.query(
      `INSERT INTO search_history ("userId", keyword, count, mode) VALUES ($1, 'query', 1, 'smart')`,
      [userId],
    );
    await assert.rejects(() =>
      dataSource.query(
        `INSERT INTO search_history ("userId", keyword, count, mode) VALUES ($1, 'query', 1, 'smart')`,
        [userId],
      ),
    );

    const avatarKey = `avatars/${userId}.png`;
    const assetKey = `assets/${userId}/document-image.png`;
    await objectStorage.putObject({
      key: avatarKey,
      body: Buffer.from("avatar"),
      contentType: "image/png",
    });
    await objectStorage.putObject({
      key: assetKey,
      body: Buffer.from("asset"),
      contentType: "image/png",
    });

    const userDataService = new UserDataService(
      users,
      dataSource.getRepository(Document),
      dataSource.getRepository(Folder),
      dataSource.getRepository(SearchHistory),
      sessions,
      dataSource.getRepository(SyncUpdate),
      dataSource.getRepository(DocSnapshot),
      dataSource,
      {
        async validatePassword() {
          return true;
        },
      } as never,
      { scheduleRecalculate() {} } as never,
      objectStorage,
    );
    await userDataService.deleteUserAccount(userId, "password-digest");

    for (const table of [
      "users",
      "sessions",
      "documents",
      "document_chunks",
      "notifications",
      "password_reset_tokens",
      "search_history",
    ]) {
      const [{ count }] = await dataSource.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      assert.equal(Number(count), 0, `${table} 应无用户残留`);
    }
    assert.equal(await objectStorage.getObject(avatarKey), null);
    assert.equal(await objectStorage.getObject(assetKey), null);
    await objectStorage.deleteObject(avatarKey);
    await objectStorage.deletePrefix(`assets/${userId}`);
  } finally {
    await dataSource.dropDatabase();
    await dataSource.destroy();
    s3.destroy();
  }
});
