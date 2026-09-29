/**
 * 工具定义校验与稳定错误类型；实际注册、发现与撤销统一由 ToolCatalog 负责。
 * 不可信插件必须经隔离与 JSON 数据边界接入，不能直接向此处传入可执行对象。
 */
import type { ToolDefinition } from './tool-definition';

/** 注册错误只包含稳定错误码，不回显工具配置。 */
export class ToolRegistryError extends Error {
  /** INVALID_DEFINITION 表示元数据不合法，DUPLICATE_TOOL 表示调用名称冲突。 */
  readonly code: 'INVALID_DEFINITION' | 'DUPLICATE_TOOL';

  constructor(code: ToolRegistryError['code']) {
    super(code);
    this.name = 'ToolRegistryError';
    this.code = code;
  }
}

function invalid(): never {
  throw new ToolRegistryError('INVALID_DEFINITION');
}

/** 对可信配置执行 JSON 可传输性检查，防止函数、undefined、非有限数或循环引用流出。 */
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null || ancestors.has(value)) invalid();
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
  ancestors.add(value);
  for (const child of Object.values(value)) assertJson(child, ancestors);
  ancestors.delete(value);
}

/**
 * 校验可信工具定义的结构与字段约束，供 ToolCatalog 在装配前调用。
 * 失败只抛出稳定错误码 INVALID_DEFINITION，不回显工具配置或 Schema 细节。
 * @param tool 由可信服务端代码提供的定义，不来自模型或客户端请求。
 */
export function assertToolDefinition(tool: ToolDefinition): void {
  assertJson(tool);
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) invalid();
  const fields = ['name', 'version', 'description', 'inputSchema', 'outputSchema', 'origin', 'riskLevel', 'requiredPermissions', 'requiresConfirmation', 'timeoutMs', 'maxOutputBytes', 'supportsCancellation', 'retryPolicy'];
  if (Object.keys(tool).length !== fields.length || Object.keys(tool).some((key) => !fields.includes(key))) invalid();
  if (typeof tool.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) invalid();
  if (typeof tool.version !== 'string' || !tool.version.trim()) invalid();
  if (typeof tool.description !== 'string' || !tool.description.trim()) invalid();
  if (!tool.inputSchema || Array.isArray(tool.inputSchema) || tool.inputSchema.type !== 'object') invalid();
  if (typeof tool.outputSchema !== 'boolean' && (typeof tool.outputSchema !== 'object' || tool.outputSchema === null || Array.isArray(tool.outputSchema))) invalid();
  if (!['L0', 'L1', 'L2', 'L3'].includes(tool.riskLevel)) invalid();
  if (!['never', 'safe', 'idempotency-key'].includes(tool.retryPolicy)) invalid();
  if (typeof tool.requiresConfirmation !== 'boolean' || typeof tool.supportsCancellation !== 'boolean') invalid();
  if (!Number.isSafeInteger(tool.timeoutMs) || tool.timeoutMs <= 0) invalid();
  if (!Number.isSafeInteger(tool.maxOutputBytes) || tool.maxOutputBytes <= 0) invalid();
  if (!Array.isArray(tool.requiredPermissions) || tool.requiredPermissions.some((p) => typeof p !== 'string' || !p.trim())) invalid();
  if (new Set(tool.requiredPermissions).size !== tool.requiredPermissions.length) invalid();
  if (!tool.origin || !['builtin', 'mcp'].includes(tool.origin.kind)) invalid();
  const originFields = tool.origin.kind === 'builtin' ? ['kind'] : ['kind', 'connectionId'];
  if (Object.keys(tool.origin).length !== originFields.length || Object.keys(tool.origin).some((key) => !originFields.includes(key))) invalid();
  if (tool.origin.kind === 'mcp' && (typeof tool.origin.connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tool.origin.connectionId))) invalid();
}
