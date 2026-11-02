/** 模型工具协议边界：只发布允许发现的定义，模型提出的调用不是执行许可。 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

import { ToolPolicy } from './tools/tool-policy';

import type { ToolCatalog } from './tools/tool-catalog';
import type { ToolDefinition, ToolJsonValue } from './tools/tool-definition';
import type { ToolPolicyContext } from './tools/tool-policy';
import type { BaseMessage } from '@langchain/core/messages';

/** 模型关联 ID 仅用于消息配对，不能用作业务 callKey、身份或授权凭据。 */
export interface AgentModelToolCall {
  /** 供应商返回的本次调用标识。 */
  id: string;
  /** 工具名称，必须属于本次暴露的工具集合。 */
  name: string;
  /** 已解码 JSON 参数；后续仍需 ToolCallPreparer 的 Schema 校验。 */
  input: { [key: string]: ToolJsonValue };
}

/** 仅保存可见消息和工具协议数据，不保存供应商原始包或隐藏推理。 */
export type AgentModelMessage =
  | { /** 消息角色。 */ role: 'system' | 'user'; /** 消息正文。 */ text: string }
  | { /** 模型消息。 */ role: 'assistant'; /** 可为空的伴随文本。 */ text: string;
      /** 非空时表示模型请求调用工具。 */ toolCalls?: AgentModelToolCall[] }
  | { /** 执行层提供的工具结果。 */ role: 'tool'; /** 已校验、受大小约束的结果文本。 */ text: string;
      /** 对应 assistant 中的调用 ID。 */ toolCallId: string };

/** 工具协议错误，不回显模型参数或权限信息。 */
export class AgentModelProtocolError extends Error {
  readonly code = 'INVALID_AGENT_MODEL_TOOL_PROTOCOL';
  constructor() { super('INVALID_AGENT_MODEL_TOOL_PROTOCOL'); this.name = 'AgentModelProtocolError'; }
}

function invalid(): never { throw new AgentModelProtocolError(); }

/** JSON 边界来自供应商反序列化；拒绝非有限数、过深结构或意外的非 JSON 值。 */
function assertJson(value: unknown, depth = 0): void {
  if (depth > 32) invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value) invalid();
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
  for (const child of Object.values(value)) assertJson(child, depth + 1);
}

/** 验证单次请求形状并复制；具体参数语义由已编译工具 Schema 负责。 */
export function validateModelToolCall(call: AgentModelToolCall): AgentModelToolCall {
  if (!call || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(call.id)
    || typeof call.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(call.name)
    || !call.input || typeof call.input !== 'object' || Array.isArray(call.input)) invalid();
  assertJson(call.input);
  if (Buffer.byteLength(JSON.stringify(call.input), 'utf8') > 65536) invalid();
  return { id: call.id, name: call.name, input: structuredClone(call.input) };
}

/** 按可信策略和 Run 固定版本发现工具；本版仅开放 builtin/L0，资源授权仍在执行时进行。 */
export function selectAgentModelTools(catalog: ToolCatalog, context: ToolPolicyContext,
  versions: Readonly<Record<string, string>>): ToolDefinition[] {
  const policy = new ToolPolicy(catalog);
  return catalog.list().filter((tool) => {
    // 仅暴露内置工具（builtin），不暴露用户自定义或外部工具。
    if (tool.origin.kind !== 'builtin') return false;
    // 仅暴露 L0 只读工具；L1 写工具（如 create_document）不进入模型可见列表，由保存层直接接管。
    if (tool.riskLevel !== 'L0') return false;
    // 工具必须在当前 Run 的 versions 清单中，且版本号完全匹配。
    if (!Object.hasOwn(versions, tool.name) || versions[tool.name] !== tool.version) return false;
    // 按用户权限策略评估：principal/allowedTools/allowL1Write 等任一维度拒绝则排除。
    const decision = policy.evaluate({ name: tool.name, expectedVersion: tool.version }, context);
    return decision.status !== 'denied';
  });
}

/**
 * 将内部 AgentModelMessage[] 转换为 LangChain BaseMessage[]，同时做完整往返校验。
 *
 * 校验规则（ReAct 消息流完整性）：
 * 1. assistant 消息含 toolCalls → 记录每个 call.id 到 pending（待结算）。
 * 2. tool 消息 → toolCallId 必须在 pending 中，匹配后移除（已结算）。
 * 3. 非 tool 消息（system/user/assistant 纯文本）前，pending 必须为空——不允许未结算调用跨越下一条消息。
 * 4. 不允许重复 call.id（seen 全局去重），不允许孤立 tool 结果（无对应 assistant 请求）。
 *
 * 这些规则保证发给供应商的消息序列是合法、可执行的 ReAct 往返。
 */
export function toAgentModelMessages(messages: AgentModelMessage[]): BaseMessage[] {
  // 守卫：消息数组长度限制（至少 system+user 两条，最多 256 条防滥用）。
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > 256) invalid();
  const pending = new Set<string>();  // 已发出 tool_call 但尚未收到 tool_result 的 call.id
  const seen = new Set<string>();     // 全局已见过的 call.id（防重复）
  const result: BaseMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message.text !== 'string' || message.text.length > 2_000_000) invalid();
    // ── tool 结果消息：必须对应一个已 pending 的 call.id，否则是孤立结果。
    if (message.role === 'tool') {
      // delete 返回 true 表示确实在 pending 中（匹配成功）；false 表示无对应请求 → 孤立结果。
      if (!pending.delete(message.toolCallId)) invalid();
      result.push(new ToolMessage({ content: message.text, tool_call_id: message.toolCallId }));
      continue;
    }
    // ── 非 tool 消息前：所有之前的 tool_call 必须已结算完毕（pending 为空）。
    // 不允许未结算调用跨越下一条 system/user/assistant 消息——这是 ReAct 基本约束。
    if (pending.size) invalid();
    // ── assistant 请求调用工具：校验每个 toolCall 并存入 pending。
    if (message.role === 'assistant' && message.toolCalls !== undefined) {
      if (!Array.isArray(message.toolCalls) || message.toolCalls.length < 1 || message.toolCalls.length > 8) invalid();
      const calls = message.toolCalls.map(validateModelToolCall);
      for (const call of calls) {
        // 同一 Run 内不允许重复 call.id（即使跨轮次）。
        if (seen.has(call.id)) invalid();
        seen.add(call.id); pending.add(call.id);
      }
      result.push(new AIMessage({ content: message.text, tool_calls: calls.map((call) => ({
        id: call.id, name: call.name, args: call.input, type: 'tool_call' as const,
      })) }));
    } else {
      // ── 普通消息（system / user / assistant 纯文本）：text 必须非空（trim 后）。
      if (!message.text.trim()) invalid();
      if (message.role === 'system') result.push(new SystemMessage(message.text));
      else if (message.role === 'user') result.push(new HumanMessage(message.text));
      else if (message.role === 'assistant') result.push(new AIMessage(message.text));
      else invalid();
    }
  }
  // 遍历结束：所有 tool_call 必须已结算（有 tool 结果匹配并移除）。
  if (pending.size) invalid();
  return result;
}
