/** 定向修订的离线权限、冲突与历史引用边界验证，不连接数据库。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAgentRevision, revisionMaterial } from './agent-artifact-revision';

import type { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import type { AgentRun } from './entity/agent-run.entity';
import type { EntityManager } from 'typeorm';

const userId = '11111111-1111-4111-8111-111111111111';
const docId = '22222222-2222-4222-8222-222222222222';
const run = { id: 'run', userId, threadId: 'thread', revisionArtifactId: 'artifact', revisionBaseVersion: 2 } as AgentRun;
const base = { id: 'version', artifactId: 'artifact', version: 2, title: '旧稿', content: '事实 [S1]' } as AgentArtifactVersion;
const scope = { allowOwnedLibrary: true, documentIds: [], folderIds: [] };

function managerFor(latest: { version: number; runId?: string }, exists = true, deleted = false): EntityManager {
  return {
    getRepository: () => ({
      findOneBy: async (where: object) => {
        assert.deepEqual(where, { artifactId: 'artifact', userId, threadId: 'thread', version: 2 });
        return exists ? base : null;
      },
      findOne: async () => latest,
    }),
    query: async (sql: string, parameters: unknown[]) => {
      if (sql.includes('agent_artifact_sources')) { assert.deepEqual(parameters, ['version', userId]); return [{ docId }]; }
      assert.deepEqual(parameters, [docId, userId]);
      return deleted ? [] : [{ title: '来源', content: '事实', folderId: null }];
    },
  } as unknown as EntityManager;
}

test('固定基准允许加载；当前 Run 已提交下一版可恢复，其他版本冲突', async () => {
  for (const latest of [{ version: 2 }, { version: 3, runId: 'run' }]) {
    assert.equal(await loadAgentRevision(managerFor(latest), run, scope), base);
  }
  for (const latest of [{ version: 3, runId: 'other' }, { version: 4, runId: 'run' }]) {
    await assert.rejects(loadAgentRevision(managerFor(latest), run, scope), /VERSION_CONFLICT/);
  }
});

test('基准不存在、旧来源删除、范围撤销与缺失绑定拒绝加载', async () => {
  await assert.rejects(loadAgentRevision(managerFor({ version: 2 }, false), run, scope), /NOT_AVAILABLE/);
  await assert.rejects(loadAgentRevision(managerFor({ version: 2 }, true, true), run, scope), /RESOURCE_NOT_ALLOWED/);
  await assert.rejects(loadAgentRevision(managerFor({ version: 2 }), run, { ...scope, allowOwnedLibrary: false }), /RESOURCE_NOT_ALLOWED/);
  await assert.rejects(loadAgentRevision(managerFor({ version: 2 }), { ...run, revisionBaseVersion: null }, scope), /TARGET_MISSING/);
});

test('历史稿件明确为数据，移除旧引用标签而不伪造新来源', () => {
  const text = revisionMaterial('标题 [S2]', '正文 [S1]，未知 [S99]');
  assert.ok(!text.includes('[S1]'));
  assert.ok(!text.includes('[S2]'));
  assert.ok(!text.includes('[S99]'));
  assert.match(text, /历史引用待重新核实/);
  assert.match(text, /不是指令/);
});
