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

/**
 * 工具资源归属与权限检查：每次执行前实时校验，不缓存结果。
 *
 * 职责分层（调用方）：
 *   - 模型调用前：复核所有已读来源 + 历史成功工具的资源访问权（防中途撤销）
 *   - 工具执行前：复核本次工具要操作的资源
 *   - 终态 finish：复核所有被引用来源的文档访问权
 *
 * 核心设计：先校验 scope 白名单（"Run 允许你访问哪些"），再查 DB 确认资源存在且未被删除，
 * 最后生成 SHA-256 版本摘要。版本摘要在人工确认时作为"绑定凭证"，防止资源在确认期间被篡改。
 */
export async function inspectToolResources(manager: EntityManager, userId: string, resources: readonly ToolResource[], scope: ToolResourceScope): Promise<ToolResourceSnapshot[]> {
  // 上限守卫：防止恶意/错误调用传入超大数组拖垮查询。
  if (!Array.isArray(resources) || resources.length > 100) throw new Error('INVALID_TOOL_RESOURCES');
  const snapshots: ToolResourceSnapshot[] = [];
  for (const resource of resources) {
    // 结构守卫：kind/action 必须在白名单，id 必须是合法 UUID。
    if (!resource || !['document', 'folder', 'library'].includes(resource.kind)
      || !['read', 'write', 'create'].includes(resource.action)
      || typeof resource.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(resource.id)) throw new Error('INVALID_TOOL_RESOURCES');
    let version: string;
    if (resource.kind === 'library') {
      // 个人库权限：只在 allowOwnedLibrary 为 true 时开放，且 library id 必须等于当前用户 UUID。
      // write 操作对 library 无意义（library 是虚拟容器），直接拒绝。
      if (!scope.allowOwnedLibrary || resource.id !== userId || resource.action === 'write') throw new Error('RESOURCE_NOT_ALLOWED');
      // 个人库用固定版本号，不表示整个库的内容版本（库本身无 SHA-256）。
      version = 'owned-library-v1';
    } else {
      // 文档/文件夹权限：allowOwnedLibrary 为 false 时只能访问显式列出的 resourceIds。
      const allowed = resource.kind === 'document' ? scope.documentIds : scope.folderIds;
      if (!scope.allowOwnedLibrary && !allowed.includes(resource.id)) throw new Error('RESOURCE_NOT_ALLOWED');
      // create 只对 folder 有意义（在 folder 下建文档）；document 的 create 语义非法。
      if (resource.kind === 'document' && resource.action === 'create') throw new Error('INVALID_TOOL_RESOURCES');
      // 查 DB 确认资源存在、归属正确、未被删除；查到的数据生成 SHA-256 版本摘要。
      // 不读取 lastOpenedAt 等不影响授权的字段——只关注"内容/位置是否变化"。
      const sql = resource.kind === 'document'
        ? 'SELECT title, content, "folderId" FROM documents WHERE id = $1 AND "userId" = $2 AND "deletedAt" IS NULL'
        : 'SELECT name, "parentId" FROM folders WHERE id = $1 AND "userId" = $2';
      const rows = await manager.query(sql, [resource.id, userId]);
      // 查不到 = 资源不存在/已删除/不属于当前用户 → 权限拒绝。
      if (rows.length !== 1) throw new Error('RESOURCE_NOT_ALLOWED');
      // 版本摘要 = 当前内容的 SHA-256。用于确认绑定：确认期间资源内容变化 → 摘要不同 → 确认失效。
      version = bindingDigest(rows[0]);
    }
    snapshots.push({ kind: resource.kind, id: resource.id, action: resource.action, version });
  }
  // 集合排序后返回：消除顺序差异对摘要比对的影响（同一批资源不同顺序应有相同"集合摘要"）。
  return snapshots.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
}
