/** 资源需求由可信适配器从已校验参数解析，模型不能自行声明授权通过。 */
import { createHash } from 'node:crypto';

import type { EntityManager } from 'typeorm';

export interface ToolResource {
  /** 首版支持个人文档、文件夹及个人库；其他资源接入时新增授权实现。 */
  kind: 'document' | 'folder' | 'library';
  /** 文档/文件夹 UUID；library 固定为当前用户 UUID。 */
  id: string;
  /** 实际需要的动作；仍须通过工具策略和业务服务复核。 */
  action: 'read' | 'write' | 'create';
}
export interface ToolResourceScope {
  /** 服务端 Run 范围；false 时只接受下面显式列出的资源，不隐式展开文件夹后代。 */
  allowOwnedLibrary: boolean;
  /** Run 允许的文档 ID。 */
  documentIds: readonly string[];
  /** Run 允许的文件夹 ID。 */
  folderIds: readonly string[];
}
export interface ToolResourceSnapshot extends ToolResource {
  /** 当前正文/位置等授权相关数据的 SHA-256；个人库为固定版本，不表示整个库内容版本。 */
  version: string;
}

/** 首版确定性 JSON 编码：对象键按 UTF-16 排序，数组顺序保留，拒绝非 JSON 值。 */
export function bindingDigest(value: unknown): string {
  function encode(item: unknown): string {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return '[' + item.map(encode).join(',') + ']';
    if (typeof item === 'object' && item !== null && Object.getPrototypeOf(item) === Object.prototype) {
      return '{' + Object.keys(item).sort().map((key) => JSON.stringify(key) + ':' + encode((item as Record<string, unknown>)[key])).join(',') + '}';
    }
    throw new Error('INVALID_CONFIRMATION_BINDING');
  }
  return createHash('sha256').update(encode(value)).digest('hex');
}

/** 每次读取当前归属和资源快照，不缓存权限；数据库故障向上传播。 */
export async function inspectToolResources(manager: EntityManager, userId: string, resources: readonly ToolResource[], scope: ToolResourceScope): Promise<ToolResourceSnapshot[]> {
  if (!Array.isArray(resources) || resources.length > 100) throw new Error('INVALID_TOOL_RESOURCES');
  const snapshots: ToolResourceSnapshot[] = [];
  for (const resource of resources) {
    if (!resource || !['document', 'folder', 'library'].includes(resource.kind)
      || !['read', 'write', 'create'].includes(resource.action)
      || typeof resource.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(resource.id)) throw new Error('INVALID_TOOL_RESOURCES');
    let version: string;
    if (resource.kind === 'library') {
      if (!scope.allowOwnedLibrary || resource.id !== userId || resource.action === 'write') throw new Error('RESOURCE_NOT_ALLOWED');
      version = 'owned-library-v1';
    } else {
      const allowed = resource.kind === 'document' ? scope.documentIds : scope.folderIds;
      if (!scope.allowOwnedLibrary && !allowed.includes(resource.id)) throw new Error('RESOURCE_NOT_ALLOWED');
      if (resource.kind === 'document' && resource.action === 'create') throw new Error('INVALID_TOOL_RESOURCES');
      // 不读取正文到事件/确认表；正文只用于版本摘要，lastOpenedAt 不影响确认。
      const sql = resource.kind === 'document'
        ? 'SELECT title, content, "folderId" FROM documents WHERE id = $1 AND "userId" = $2 AND "deletedAt" IS NULL'
        : 'SELECT name, "parentId" FROM folders WHERE id = $1 AND "userId" = $2';
      const rows = await manager.query(sql, [resource.id, userId]);
      if (rows.length !== 1) throw new Error('RESOURCE_NOT_ALLOWED');
      version = bindingDigest(rows[0]);
    }
    snapshots.push({ kind: resource.kind, id: resource.id, action: resource.action, version });
  }
  // 资源集合顺序不影响摘要；不改变工具参数中数组的语义顺序。
  return snapshots.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
}
