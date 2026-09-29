/** 保存工具在服务启动时装配；用户选定成果后才创建调用，模型不能指定正文或绕过原子写入入口。 */
import type { ToolCatalog } from './tool-catalog';

/** 注册保存契约；实际执行必须交给 AgentDocumentWriter，禁止通用只读执行器调用。 */
export function registerCreateDocumentTool(catalog: ToolCatalog): void {
  catalog.register({
    name: 'create_document', version: '1', description: '将已选定且确认的草稿版本保存为个人文档',
    origin: { kind: 'builtin' }, riskLevel: 'L1', requiredPermissions: ['documents:create'], requiresConfirmation: true,
    inputSchema: { type: 'object', properties: {
      saveId: { type: 'string', pattern: '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }, saveDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      folderId: { anyOf: [{ type: 'string', pattern: '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }, { type: 'null' }] },
    }, required: ['saveId', 'saveDigest', 'folderId'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { documentId: { type: 'string', pattern: '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' } }, required: ['documentId'], additionalProperties: false },
    timeoutMs: 10000, maxOutputBytes: 1024, supportsCancellation: false, retryPolicy: 'never',
  }, {
    name: 'create_document', version: '1', origin: { kind: 'builtin' },
    resources: (input, userId) => {
      const folderId = (input as { folderId: string | null }).folderId;
      return [folderId ? { kind: 'folder', id: folderId, action: 'create' } : { kind: 'library', id: userId, action: 'create' }];
    },
    async execute() { throw new Error('ATOMIC_DOCUMENT_WRITER_REQUIRED'); },
  });
}
