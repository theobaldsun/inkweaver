/** FoldersService 目录计数回归测试。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { FoldersService } from './folders.service';

test('目录树使用服务端未删除文档计数且保留嵌套层级', async () => {
  const root = {
    id: '11111111-1111-4111-8111-111111111111',
    name: '根下目录',
    userId: 'user-1',
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const child = {
    ...root,
    id: '22222222-2222-4222-8222-222222222222',
    name: '子目录',
    parentId: root.id,
  };
  const foldersRepository = {
    async find() { return [root, child]; },
  };
  const queryBuilder = {
    select() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    groupBy() { return this; },
    async getRawMany() { return [{ folderId: child.id, count: '75' }]; },
  };
  const documentsRepository = {
    createQueryBuilder() { return queryBuilder; },
  };
  const service = new FoldersService(
    foldersRepository as never,
    documentsRepository as never,
    {} as never,
    {} as never,
  );

  const tree = await service.getFolderTree('user-1');
  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.documentCount, 0);
  assert.equal(tree[0]?.children?.[0]?.id, child.id);
  assert.equal((tree[0]?.children?.[0] as unknown as { documentCount: number }).documentCount, 75);
});
