/**
 * 工具调用准备：串联策略预检查、装配解析和输入 Schema 校验，不执行工具。
 * 输入参数来自 JSON 解码边界，身份、权限和固定版本来自可信服务端。
 * 返回结果是可供后续资源授权使用的数据快照，不是确认令牌或执行许可。
 */
import { ToolAssemblyError } from './tool-catalog';
import { ToolPolicy } from './tool-policy';

import type { ToolCatalog } from './tool-catalog';
import type { ToolJsonValue } from './tool-definition';
import type { ToolPolicyContext, ToolPolicyDenial, ToolPolicyRequest } from './tool-policy';

/** 请求只包含工具选择与 JSON 参数，不允许在参数中声明有效权限。 */
export interface ToolCallPreparationRequest extends ToolPolicyRequest {
  /** 已经 JSON 解码的参数；不接受进程内插件对象作为安全边界。 */
  input: ToolJsonValue;
}

/** 与本次通过校验的输入对应，不包含函数句柄或权限列表。 */
export interface PreparedToolCall {
  /** 当前已认证用户 ID，由可信上下文取得。 */
  userId: string;
  /** 本次工具名称。 */
  name: string;
  /** 与目录精确匹配的版本。 */
  version: string;
  /** 已通过 Schema 的独立参数副本；修改后必须重新准备和校验。 */
  input: ToolJsonValue;
}

/** prepared 不表示可直接执行：资源授权、Run 状态、确认与预算检查仍未完成。 */
export type ToolCallPreparationResult =
  | {
    /** 预检查及参数校验完成。 */
    status: 'prepared';
    /** 供后续检查使用的参数快照。 */
    call: PreparedToolCall;
    /** 策略要求后续确认；尚未发起、获取或验证确认。 */
    requiresConfirmation: boolean;
  }
  | {
    /** 策略拒绝或输入不符合 Schema，不返回原始参数。 */
    status: 'rejected';
    /** 稳定原因，不附带用户输入或工具内部错误。 */
    reason: ToolPolicyDenial | 'INVALID_TOOL_INPUT';
  };

/** 每次从同一装配目录查询策略与校验器，不缓存前次通过结果。 */
export class ToolCallPreparer {
  /** 仅解析当前已装配版本。 */
  private readonly catalog: ToolCatalog;
  /** 与装配解析共用目录，避免策略检查未装配的另一份定义。 */
  private readonly policy: ToolPolicy;

  constructor(catalog: ToolCatalog) {
    this.catalog = catalog;
    this.policy = new ToolPolicy(catalog);
  }

  /**
   * 按“策略 → 解析 → 参数副本校验”准备调用，既不调用适配器也不发起确认。
   * 待确认工具也必须先通过 Schema，防止为无效参数生成确认请求。
   * 返回值不携带 execute；执行层需重新解析并复核，不能把快照当作授权凭证。
   * @param request 工具名称、服务端固定版本与 JSON 参数。
   * @param context 当前可信身份及有效策略。
   */
  prepare(request: ToolCallPreparationRequest, context: ToolPolicyContext): ToolCallPreparationResult {
    const decision = this.policy.evaluate(request, context);
    if (decision.status === 'denied') return { status: 'rejected', reason: decision.reason };

    let tool;
    try {
      tool = this.catalog.resolve(request.name, request.expectedVersion);
    } catch (error) {
      // 当前链路同步执行；仍明确处理目录解析失败，避免将其当作已准备成功。
      if (error instanceof ToolAssemblyError && error.code === 'TOOL_NOT_ASSEMBLED') {
        return { status: 'rejected', reason: 'TOOL_NOT_REGISTERED' };
      }
      if (error instanceof ToolAssemblyError && error.code === 'VERSION_MISMATCH') {
        return { status: 'rejected', reason: 'VERSION_MISMATCH' };
      }
      throw error;
    }

    // 对独立副本校验并返回同一副本，后续修改调用方原参数不会改变准备结果。
    const input = structuredClone(request.input);
    if (!tool.validateInput(input).ok) return { status: 'rejected', reason: 'INVALID_TOOL_INPUT' };
    return {
      status: 'prepared',
      call: { userId: context.principal!.userId, name: tool.definition.name, version: tool.definition.version, input },
      requiresConfirmation: decision.status === 'confirmation_required',
    };
  }
}
