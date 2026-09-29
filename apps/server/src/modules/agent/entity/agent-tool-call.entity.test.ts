import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSource } from 'typeorm';

import { AgentToolCall } from './agent-tool-call.entity';

/** 仅构建真实 ORM 元数据，不连接数据库。 */
class OfflineSource extends DataSource {
  async prepare(): Promise<void> { await this.buildMetadatas(); }
}

test('工具调用映射保留数据库类型、空值与默认值，不使用自动版本更新', async () => {
  const source = new OfflineSource({ type: 'postgres', entities: [AgentToolCall], synchronize: false });
  await source.prepare();
  const metadata = source.getMetadata(AgentToolCall);
  assert.equal(metadata.tableName, 'agent_tool_calls');
  assert.equal(metadata.columns.length, 18);
  assert.deepEqual(metadata.primaryColumns.map((column) => column.propertyName), ['id']);
  const column = (name: string) => {
    const value = metadata.findColumnWithPropertyName(name);
    assert.ok(value);
    return value;
  };
  assert.equal(column('input').type, 'jsonb');
  assert.equal(column('connectionId').isNullable, true);
  assert.equal(column('requiresConfirmation').default, undefined);
  assert.equal(column('requiresConfirmation').isNullable, false);
  assert.equal(column('status').default, 'PREPARED');
  assert.equal(column('sideEffect').default, 'none');
  assert.equal(column('cancelRequested').default, false);
  assert.equal(column('retryNotBefore').isNullable, true);
  assert.equal(column('retryNotBefore').type, 'timestamptz');
  assert.equal(column('attemptCount').default, 0);
  assert.equal(column('revision').default, 0);
  assert.equal(column('revision').isVersion, false);
  assert.equal(column('updatedAt').isUpdateDate, false);
  assert.equal(column('createdAt').type, 'timestamptz');
  assert.equal(column('id').isGenerated, false);
  const [sql, parameters] = source.getRepository(AgentToolCall).createQueryBuilder().insert().values({
    id: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333',
    userId: '11111111-1111-4111-8111-111111111111', callKey: 'step-1', toolName: 'read_document', toolVersion: 'v1',
    originKind: 'builtin', connectionId: null, input: { docId: 'doc' }, requiresConfirmation: false,
  }).getQueryAndParameters();
  assert.match(sql, /^INSERT INTO "agent_tool_calls"/);
  assert.ok(parameters.includes(JSON.stringify({ docId: 'doc' })));
  assert.ok(parameters.includes(null));
});
