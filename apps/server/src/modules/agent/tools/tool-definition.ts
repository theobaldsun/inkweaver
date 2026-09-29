/**
 * 服务端工具描述契约：内置工具和未来 MCP 适配器共用。
 * 注册信息由可信服务端代码提供，不含执行函数、连接凭据或用户授权结果。
 */

/** Schema 中可序列化的 JSON 值。 */
export type ToolJsonValue = null | boolean | number | string | ToolJsonValue[] | { [key: string]: ToolJsonValue };

/** JSON Schema 描述；完整语义校验由后续工具适配器/执行层负责。 */
export type ToolSchema = boolean | { [key: string]: ToolJsonValue };

/** 来源只标识适配器归属，不携带外部服务器地址或认证信息。 */
export type ToolOrigin =
  | { /** 内置服务端实现。 */ kind: 'builtin' }
  | { /** 经服务端批准的 MCP 连接。 */ kind: 'mcp'; /** 服务端连接注册 ID，不是 URL。 */ connectionId: string };

/** 工具定义仅描述能力；发现或注册成功均不代表已授权执行。 */
export interface ToolDefinition {
  /** 全局唯一调用名称；同名多版本不得同时注册，避免模型调用歧义。 */
  name: string;
  /** 实现版本，由 Graph 初始化时固定并在调用记录中保留；目录不会自动升级旧调用。 */
  version: string;
  /** 面向调用方的用途说明，不应含凭据或用户资料。 */
  description: string;
  /** 输入 JSON Schema，根必须声明 object；不绑定特定 Schema 库。 */
  inputSchema: { [key: string]: ToolJsonValue; type: 'object' };
  /** 输出 JSON Schema；结果如何承载内容块由具体工具描述。 */
  outputSchema: ToolSchema;
  /** 来源适配器信息。 */
  origin: ToolOrigin;
  /** L0 读取，L1 创建，L2 修改，L3 删除/分享/外部写入；策略层决定是否开放。 */
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
  /** 执行前必须满足的权限标识；空数组也不能跳过用户身份检查。 */
  requiredPermissions: string[];
  /** 是否要求执行前确认；风险策略可加强此要求。 */
  requiresConfirmation: boolean;
  /** 单次调用超时，单位毫秒，正安全整数。 */
  timeoutMs: number;
  /** 工具结果预算，单位 UTF-8 字节，正安全整数。 */
  maxOutputBytes: number;
  /** 适配器是否支持协作式取消，不代表可撤销已提交的写入。 */
  supportsCancellation: boolean;
  /** 禁止重试、安全重试，或仅携带幂等键时允许重试。 */
  retryPolicy: 'never' | 'safe' | 'idempotency-key';
}
