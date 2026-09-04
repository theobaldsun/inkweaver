/**
 * Sync/Documents 循环依赖元数据回归测试。
 *
 * AppModule 必须先加载，以复现生产启动时的 CommonJS 模块求值顺序；
 * 单独导入 SyncModule 会掩盖 DocumentsModule 被解析为 undefined 的问题。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';

interface ForwardReference<T> {
  forwardRef(): T;
}

interface DeclaredDependency {
  index: number;
  param: unknown;
}

test('AppModule 加载顺序下延迟解析 Sync/Documents 循环依赖', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousDbPassword = process.env.DB_PASSWORD;

  // 动态导入前提供生产配置，既复现真实模块加载顺序，又不依赖开发机 .env。
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'sync-module-regression-test-jwt-secret-32-bytes';
  process.env.DB_PASSWORD = 'sync-module-regression-test-db-password';

  try {
    const { AppModule } = await import('../../app.module.js');
    const { DocumentsModule } = await import('../documents/documents.module.js');
    const { DocumentsService } = await import('../documents/documents.service.js');
    const { DocumentProjectionService } = await import('./document-projection.service.js');
    const { SyncGateway } = await import('./sync.gateway.js');
    const { SyncModule } = await import('./sync.module.js');

    assert.equal(typeof AppModule, 'function');

    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, SyncModule) as unknown[];
    const documentsModuleRef = imports[3] as ForwardReference<unknown> | undefined;
    assert.ok(documentsModuleRef);
    assert.equal(typeof documentsModuleRef.forwardRef, 'function');
    assert.equal(documentsModuleRef.forwardRef(), DocumentsModule);

    const dependencies = (
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, SyncGateway) as
        | DeclaredDependency[]
        | undefined
    ) ?? [];
    const documentsServiceDependency = dependencies.find(({ index }) => index === 2);
    const documentsServiceRef = documentsServiceDependency?.param as
      | ForwardReference<unknown>
      | undefined;

    assert.ok(documentsServiceRef);
    assert.equal(typeof documentsServiceRef.forwardRef, 'function');
    assert.equal(documentsServiceRef.forwardRef(), DocumentsService);

    const projectionDependencies = (
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, DocumentProjectionService) as
        | DeclaredDependency[]
        | undefined
    ) ?? [];
    const projectionDocumentsDependency = projectionDependencies.find(({ index }) => index === 2);
    const projectionDocumentsRef = projectionDocumentsDependency?.param as
      | ForwardReference<unknown>
      | undefined;

    assert.ok(projectionDocumentsRef);
    assert.equal(typeof projectionDocumentsRef.forwardRef, 'function');
    assert.equal(projectionDocumentsRef.forwardRef(), DocumentsService);

    const projectionDependency = dependencies.find(({ index }) => index === 3);
    const projectionRef = projectionDependency?.param as ForwardReference<unknown> | undefined;

    assert.ok(projectionRef);
    assert.equal(typeof projectionRef.forwardRef, 'function');
    assert.equal(projectionRef.forwardRef(), DocumentProjectionService);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousDbPassword === undefined) delete process.env.DB_PASSWORD;
    else process.env.DB_PASSWORD = previousDbPassword;
  }
});
