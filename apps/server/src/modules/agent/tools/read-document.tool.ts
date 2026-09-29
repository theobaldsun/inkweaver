/** 首个真实只读工具：按归属读取个人文档，并比较授权阶段的正文/位置版本。 */
import { bindingDigest } from './tool-resources';

import type { ToolCatalog } from './tool-catalog';
import type { EntityManager } from 'typeorm';

/** 可信启动代码注册；不加载插件、不读取公开分享链接。 */
export function registerReadDocumentTool(catalog: ToolCatalog, manager: EntityManager): void {
  catalog.register({ name: 'read_document', version: '1', description: '读取指定个人文档',
    origin: { kind: 'builtin' }, riskLevel: 'L0', requiredPermissions: ['documents:read'], requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } }, required: ['id'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, version: { type: 'string' } },
      required: ['id', 'title', 'content', 'version'], additionalProperties: false },
    timeoutMs: 10000, maxOutputBytes: 262144, supportsCancellation: false, retryPolicy: 'safe',
  }, { name: 'read_document', version: '1', origin: { kind: 'builtin' },
    resources: (input) => [{ kind: 'document', id: (input as { id: string }).id, action: 'read' }],
    async execute(input, context) {
      if (context.signal.aborted || !context.execution) throw new Error('READ_NOT_AVAILABLE');
      const id = (input as { id: string }).id;
      const expected = context.execution.resources.find((resource) => resource.kind === 'document' && resource.id === id && resource.action === 'read');
      if (!expected) throw new Error('READ_NOT_AVAILABLE');
      const rows = await manager.query(`SELECT title, content, "folderId" FROM documents
        WHERE id=$1 AND "userId"=$2 AND "deletedAt" IS NULL AND octet_length(content) <= 262144`, [id, context.userId]);
      if (rows.length !== 1 || context.signal.aborted) throw new Error('READ_NOT_AVAILABLE');
      const version = bindingDigest(rows[0]);
      if (version !== expected.version) throw new Error('READ_NOT_AVAILABLE');
      return { id, title: rows[0].title, content: rows[0].content, version };
    },
  });
}
