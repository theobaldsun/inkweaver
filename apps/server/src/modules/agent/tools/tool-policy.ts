/**
 * 工具调用前的服务端策略判断，不执行工具、不验证确认令牌或具体资源归属。
 * 身份和授权上下文必须来自可信服务端，不能由模型、工具结果或请求正文签发。
 * 由 Agent 应用链间接调用，不单独注册 HTTP 入口；结果仅为即时预检查，不可作为可重用授权凭证。
 */
import type { ToolDefinition } from './tool-definition';

/** 当前请求经认证和权限系统解析后的主体；缺失主体按未认证处理。 */
export interface ToolPrincipal {
  /** 经服务端认证的用户 ID。 */
  userId: string;
  /** 本次调用时重新取得的权限，不支持通配符或隐式继承。 */
  permissions: readonly string[];
}

/** 可信服务端配置与 Run 范围求交后得到的有效策略。 */
export interface ToolPolicyContext {
  /** 未认证时为 null；工具不要求业务权限也必须有认证主体。 */
  principal: ToolPrincipal | null;
  /** 显式允许的工具名称；空数组拒绝全部工具。 */
  allowedTools: readonly string[];
  /** 允许的风险等级；省略仅开放 L0，空数组全部关闭。 */
  allowedRiskLevels?: readonly ToolDefinition['riskLevel'][];
  /** 当前用户获准使用的 MCP 连接 ID；省略或空数组均关闭 MCP。 */
  allowedMcpConnections?: readonly string[];
}

/** 调用名称可来自模型；期望版本由服务端 Run 固定，不能由模型自行放宽。 */
export interface ToolPolicyRequest {
  /** 已注册工具名称。 */
  name: string;
  /** 本次运行固定的工具版本，必须精确匹配当前目录。 */
  expectedVersion: string;
}

/** 拒绝理由不包含 Schema、用户权限集合或连接配置。 */
export type ToolPolicyDenial =
  | 'UNAUTHENTICATED'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_NOT_REGISTERED'
  | 'VERSION_MISMATCH'
  | 'RISK_DISABLED'
  | 'CONNECTION_NOT_ALLOWED'
  | 'MISSING_PERMISSION';

/** allowed 仅代表本层检查通过；写入确认和资源授权必须由执行层完成。 */
export type ToolPolicyDecision =
  | { /** 本层预检查通过。 */ status: 'allowed' }
  | { /** 仍须绑定具体参数获取并验证确认，不可直接执行。 */ status: 'confirmation_required' }
  | { /** 当前策略拒绝调用。 */ status: 'denied'; /** 稳定拒绝原因。 */ reason: ToolPolicyDenial };

/** 目录的只读视图；ToolCatalog 直接满足，其他实现也不得附带授权语义。 */
export interface ToolLookup {
  /** 按名称取当前定义副本；未注册返回 undefined，调用方不得据此跳过授权。 */
  get(name: string): ToolDefinition | undefined;
}

/** 无授权缓存，每次查询当前目录与调用方提供的最新有效权限。 */
export class ToolPolicy {
  /** 共享注册目录；不持有用户身份或前次检查结果。 */
  private readonly registry: ToolLookup;

  constructor(registry: ToolLookup) {
    this.registry = registry;
  }

  /**
   * 判断一次调用是否符合有效策略。
   * 先检查身份和工具允许列表，避免向未获准调用者披露注册详情。
   * 所有拒绝条件优先于确认；L1-L3 即使描述声明无需确认，也至少返回待确认。
   * 通过后仍需 Schema/资源校验；执行前必须复核策略，不能复用旧结果。
   * @param request 工具名称与服务端固定版本。
   * @param context 可信的当前有效策略，不从用户消息直接反序列化取得。
   */
  evaluate(request: ToolPolicyRequest, context: ToolPolicyContext): ToolPolicyDecision {
    if (!context.principal || !context.principal.userId.trim()) {
      return { status: 'denied', reason: 'UNAUTHENTICATED' };
    }
    if (!context.allowedTools.includes(request.name)) return { status: 'denied', reason: 'TOOL_NOT_ALLOWED' };
    const tool = this.registry.get(request.name);
    if (!tool) return { status: 'denied', reason: 'TOOL_NOT_REGISTERED' };
    if (tool.version !== request.expectedVersion) return { status: 'denied', reason: 'VERSION_MISMATCH' };
    if (!(context.allowedRiskLevels ?? ['L0']).includes(tool.riskLevel)) return { status: 'denied', reason: 'RISK_DISABLED' };
    if (tool.origin.kind === 'mcp' && !(context.allowedMcpConnections ?? []).includes(tool.origin.connectionId)) {
      return { status: 'denied', reason: 'CONNECTION_NOT_ALLOWED' };
    }
    if (!tool.requiredPermissions.every((permission) => context.principal!.permissions.includes(permission))) {
      return { status: 'denied', reason: 'MISSING_PERMISSION' };
    }
    if (tool.requiresConfirmation || tool.riskLevel !== 'L0') return { status: 'confirmation_required' };
    return { status: 'allowed' };
  }
}
