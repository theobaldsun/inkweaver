/**
 * Web/Server 核心 HTTP 链路集成测试。
 *
 * 覆盖注册登录、连续与并发刷新、文档创建编辑、跨层级/根目录移动、
 * 搜索、MinIO 上传、导出、清空全部数据和账户注销。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";

import { GlobalHttpExceptionFilter } from "./common/global-http-exception.filter";
import { ObjectStorageService } from "./modules/storage/object-storage.service";
import { createUploadsMiddleware } from "./modules/storage/uploads.middleware";

import type { NestExpressApplication } from "@nestjs/platform-express";
import type { AddressInfo } from "node:net";

const shouldRun = process.env.RUN_INTEGRATION_TESTS === "1";
const passwordDigest = createHash("sha256").update("e2e-password").digest("hex");
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface JsonResponse<T> {
  response: Response;
  body: T;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  sessionId: string;
  user: { id: string; email: string; name: string };
}

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
}

interface CheckSessionResponse extends RefreshResponse {
  isValid: boolean;
}

function configureIntegrationEnvironment(): void {
  Object.assign(process.env, {
    NODE_ENV: "test",
    TYPEORM_ENABLED: "true",
    DB_HOST: "127.0.0.1",
    DB_PORT: "5433",
    DB_USERNAME: "inkweaver_test",
    DB_PASSWORD: "inkweaver_test",
    DB_DATABASE: "syncbox_test",
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: "6380",
    JWT_SECRET: "integration-only-jwt-secret-at-least-32-bytes",
    MINIO_ENDPOINT: "http://127.0.0.1:9002",
    MINIO_ACCESS_KEY: "inkweaver_test",
    MINIO_SECRET_KEY: "inkweaver_test_secret",
    MINIO_BUCKET: "inkweaver-test",
  });
}

function createSchemaDataSource(): DataSource {
  return new DataSource({
    type: "postgres",
    host: "127.0.0.1",
    port: 5433,
    username: "inkweaver_test",
    password: "inkweaver_test",
    database: "syncbox_test",
    entities: [join(__dirname, "**", "*.entity.js")],
    migrations: [join(__dirname, "migrations", "*.js")],
    synchronize: false,
  });
}

async function ensureMinioBucket(): Promise<S3Client> {
  const client = new S3Client({
    endpoint: "http://127.0.0.1:9002",
    region: "us-east-1",
    credentials: {
      accessKeyId: "inkweaver_test",
      secretAccessKey: "inkweaver_test_secret",
    },
    forcePathStyle: true,
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: "inkweaver-test" }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      client.destroy();
      throw error;
    }
  }
  return client;
}

async function startEmbeddingFixture(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    if (request.url === "/embed" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        texts?: unknown[];
      };
      const vectors = (payload.texts ?? []).map(() => Array<number>(512).fill(0));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ vectors }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<JsonResponse<T>> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await response.json()) as T;
  return { response, body };
}

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

test("核心 HTTP E2E 完成注册到注销的完整业务闭环", { skip: !shouldRun }, async () => {
  configureIntegrationEnvironment();
  const schemaDataSource = createSchemaDataSource();
  const minio = await ensureMinioBucket();
  const embedding = await startEmbeddingFixture();
  process.env.AI_EMBED_BASE_URL = embedding.baseUrl;
  process.env.AI_EMBED_TOKEN = "integration-embedding-token";

  let app: NestExpressApplication | undefined;
  try {
    await schemaDataSource.initialize();
    await schemaDataSource.dropDatabase();
    await schemaDataSource.runMigrations({ transaction: "all" });
    await schemaDataSource.destroy();

    const { AppModule } = await import("./app.module.js");
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });
    app.use("/uploads", createUploadsMiddleware(app.get(ObjectStorageService)));
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const registered = await jsonRequest<AuthResponse>(baseUrl, "/api/users/register", {
      method: "POST",
      body: JSON.stringify({
        email: "core-http@example.test",
        name: "Core HTTP",
        passwordHash: passwordDigest,
      }),
    });
    assert.equal(registered.response.status, 201);
    assert.match(registered.body.access_token, /\S+/);

    const loggedIn = await jsonRequest<AuthResponse>(baseUrl, "/api/users/login", {
      method: "POST",
      body: JSON.stringify({
        email: registered.body.user.email,
        passwordHash: passwordDigest,
      }),
    });
    assert.equal(loggedIn.response.status, 201);

    const refreshOne = await jsonRequest<RefreshResponse>(baseUrl, "/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: loggedIn.body.refresh_token }),
    });
    assert.equal(refreshOne.response.status, 201);
    const refreshTwo = await jsonRequest<RefreshResponse>(baseUrl, "/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshOne.body.refresh_token }),
    });
    assert.equal(refreshTwo.response.status, 201);
    const replayed = await jsonRequest<Record<string, unknown>>(baseUrl, "/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshOne.body.refresh_token }),
    });
    assert.equal(replayed.response.status, 401);

    const reloadOne = await jsonRequest<CheckSessionResponse>(baseUrl, "/api/auth/check-session", {
      method: "POST",
      body: JSON.stringify({
        userId: registered.body.user.id,
        refresh_token: refreshTwo.body.refresh_token,
      }),
    });
    assert.equal(reloadOne.response.status, 201);
    assert.equal(reloadOne.body.isValid, true);
    const reloadTwo = await jsonRequest<CheckSessionResponse>(baseUrl, "/api/auth/check-session", {
      method: "POST",
      body: JSON.stringify({
        userId: registered.body.user.id,
        refresh_token: reloadOne.body.refresh_token,
      }),
    });
    assert.equal(reloadTwo.response.status, 201);
    assert.equal(reloadTwo.body.isValid, true);
    const staleReload = await jsonRequest<{ isValid: boolean }>(
      baseUrl,
      "/api/auth/check-session",
      {
        method: "POST",
        body: JSON.stringify({
          userId: registered.body.user.id,
          refresh_token: reloadOne.body.refresh_token,
        }),
      },
    );
    assert.equal(staleReload.response.status, 201);
    assert.equal(staleReload.body.isValid, false);

    const concurrent = await Promise.all([
      jsonRequest<RefreshResponse>(baseUrl, "/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: reloadTwo.body.refresh_token }),
      }),
      jsonRequest<RefreshResponse>(baseUrl, "/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: reloadTwo.body.refresh_token }),
      }),
    ]);
    assert.deepEqual(concurrent.map(({ response }) => response.status).sort(), [201, 401]);
    const currentAuth = concurrent.find(({ response }) => response.status === 201)?.body;
    assert.ok(currentAuth);
    let accessToken = currentAuth.access_token;

    const rootFolder = await jsonRequest<{ id: string }>(baseUrl, "/api/folders", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({ name: "Root folder" }),
    });
    assert.equal(rootFolder.response.status, 201);
    const childFolder = await jsonRequest<{ id: string }>(baseUrl, "/api/folders", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({ name: "Child folder", parentId: rootFolder.body.id }),
    });
    assert.equal(childFolder.response.status, 201);

    const created = await jsonRequest<{ id: string; folderId: string }>(baseUrl, "/api/documents", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({
        title: "Project Phoenix",
        content: "HTTP E2E searchable content",
        tags: ["phoenix"],
        folderId: childFolder.body.id,
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.folderId, childFolder.body.id);

    const movedToRoot = await jsonRequest<{ folderId: string | null; content: string }>(
      baseUrl,
      `/api/documents/${created.body.id}`,
      {
        method: "PUT",
        headers: bearer(accessToken),
        body: JSON.stringify({
          content: "HTTP E2E searchable content updated",
          folderId: null,
        }),
      },
    );
    assert.equal(movedToRoot.response.status, 200);
    assert.equal(movedToRoot.body.folderId, null);

    const movedAcrossLevels = await jsonRequest<{ folderId: string }>(
      baseUrl,
      `/api/documents/${created.body.id}`,
      {
        method: "PUT",
        headers: bearer(accessToken),
        body: JSON.stringify({ folderId: rootFolder.body.id }),
      },
    );
    assert.equal(movedAcrossLevels.response.status, 200);
    assert.equal(movedAcrossLevels.body.folderId, rootFolder.body.id);

    const search = await jsonRequest<{ documents: Array<{ id: string }>; total: number }>(
      baseUrl,
      "/api/search/hybrid?q=Project%20Phoenix&mode=keyword&page=1&pageSize=10",
      { headers: bearer(accessToken) },
    );
    assert.equal(search.response.status, 200);
    assert.ok(search.body.total >= 1);
    assert.ok(search.body.documents.some(({ id }) => id === created.body.id));

    const uploadForm = new FormData();
    uploadForm.set("file", new Blob([pngBytes], { type: "image/png" }), "document.png");
    const uploaded = await jsonRequest<{ url: string }>(baseUrl, "/api/storage/upload", {
      method: "POST",
      headers: bearer(accessToken),
      body: uploadForm,
    });
    assert.equal(uploaded.response.status, 201);
    assert.match(uploaded.body.url, new RegExp(`/assets/${registered.body.user.id}/`));
    assert.equal((await fetch(`${baseUrl}${uploaded.body.url}`)).status, 200);

    const avatarForm = new FormData();
    avatarForm.set("file", new Blob([pngBytes], { type: "image/png" }), "avatar.png");
    const avatar = await jsonRequest<{ avatarUrl: string }>(baseUrl, "/api/users/avatar", {
      method: "POST",
      headers: bearer(accessToken),
      body: avatarForm,
    });
    assert.equal(avatar.response.status, 201);
    assert.equal((await fetch(`${baseUrl}${avatar.body.avatarUrl}`)).status, 200);

    const exported = await jsonRequest<{
      profile: { id: string };
      documents: Array<{ id: string }>;
    }>(baseUrl, "/api/users/export", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({ passwordHash: passwordDigest }),
    });
    assert.equal(exported.response.status, 201);
    assert.equal(exported.body.profile.id, registered.body.user.id);
    assert.ok(exported.body.documents.some(({ id }) => id === created.body.id));

    const purged = await jsonRequest<{ message: string }>(baseUrl, "/api/users/data", {
      method: "DELETE",
      headers: bearer(accessToken),
      body: JSON.stringify({ passwordHash: passwordDigest }),
    });
    assert.equal(purged.response.status, 200);
    assert.equal((await fetch(`${baseUrl}${uploaded.body.url}`)).status, 404);
    const emptyList = await jsonRequest<{ total: number }>(
      baseUrl,
      "/api/documents?page=1&pageSize=10",
      { headers: bearer(accessToken) },
    );
    assert.equal(emptyList.response.status, 200);
    assert.equal(emptyList.body.total, 0);

    const purgedSession = await jsonRequest<Record<string, unknown>>(baseUrl, "/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: currentAuth.refresh_token }),
    });
    assert.equal(purgedSession.response.status, 401);
    const relogged = await jsonRequest<AuthResponse>(baseUrl, "/api/users/login", {
      method: "POST",
      body: JSON.stringify({
        email: registered.body.user.email,
        passwordHash: passwordDigest,
      }),
    });
    assert.equal(relogged.response.status, 201);
    accessToken = relogged.body.access_token;

    const recreated = await jsonRequest<{ id: string }>(baseUrl, "/api/documents", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({ title: "Before account deletion", content: "" }),
    });
    assert.equal(recreated.response.status, 201);

    const deletedAccount = await jsonRequest<{ message: string }>(baseUrl, "/api/users/account", {
      method: "DELETE",
      headers: bearer(accessToken),
      body: JSON.stringify({ passwordHash: passwordDigest }),
    });
    assert.equal(deletedAccount.response.status, 200);
    assert.equal((await fetch(`${baseUrl}${avatar.body.avatarUrl}`)).status, 404);
    const oldAccess = await jsonRequest<Record<string, unknown>>(baseUrl, "/api/users/profile", {
      headers: bearer(accessToken),
    });
    assert.equal(oldAccess.response.status, 401);
  } finally {
    await app?.close();
    await embedding.close();
    minio.destroy();
    if (schemaDataSource.isInitialized) await schemaDataSource.destroy();
    const cleanupDataSource = createSchemaDataSource();
    try {
      await cleanupDataSource.initialize();
      await cleanupDataSource.dropDatabase();
    } finally {
      if (cleanupDataSource.isInitialized) await cleanupDataSource.destroy();
    }
  }
});
