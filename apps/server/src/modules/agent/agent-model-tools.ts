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
  return catalog.list().filter((tool) => tool.origin.kind === 'builtin' && tool.riskLevel === 'L0'
    && Object.hasOwn(versions, tool.name) && versions[tool.name] === tool.version
    && policy.evaluate({ name: tool.name, expectedVersion: tool.version }, context).status !== 'denied');
}

/** 转换消息并校验完整往返；不允许孤立、重复结果或未结算调用跨越下一条用户消息。 */
export function toAgentModelMessages(messages: AgentModelMessage[]): BaseMessage[] {
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > 256) invalid();
  const pending = new Set<string>();
  const seen = new Set<string>();
  const result: BaseMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message.text !== 'string' || message.text.length > 2_000_000) invalid();
    if (message.role === 'tool') {
      if (!pending.delete(message.toolCallId)) invalid();
      result.push(new ToolMessage({ content: message.text, tool_call_id: message.toolCallId }));
      continue;
    }
    if (pending.size) invalid();
    if (message.role === 'assistant' && message.toolCalls !== undefined) {
      if (!Array.isArray(message.toolCalls) || message.toolCalls.length < 1 || message.toolCalls.length > 8) invalid();
      const calls = message.toolCalls.map(validateModelToolCall);
      for (const call of calls) {
        if (seen.has(call.id)) invalid();
        seen.add(call.id); pending.add(call.id);
      }
      result.push(new AIMessage({ content: message.text, tool_calls: calls.map((call) => ({
        id: call.id, name: call.name, args: call.input, type: 'tool_call' as const,
      })) }));
    } else {
      if (!message.text.trim()) invalid();
      if (message.role === 'system') result.push(new SystemMessage(message.text));
      else if (message.role === 'user') result.push(new HumanMessage(message.text));
      else if (message.role === 'assistant') result.push(new AIMessage(message.text));
      else invalid();
    }
  }
  if (pending.size) invalid();
  return result;
}
