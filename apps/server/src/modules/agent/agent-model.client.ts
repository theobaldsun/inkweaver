/** Agent 专用模型适配器；与快捷问答 ChatClient 分离，避免两条产品链互相耦合。 */
import { ChatOpenAI } from '@langchain/openai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { estimateAgentTokens } from './agent-context';
import { AgentModelProtocolError, toAgentModelMessages, validateModelToolCall } from './agent-model-tools';
import { loadAgentModelConfiguration } from './agent-model.config';

import type { AgentModelMessage, AgentModelToolCall } from './agent-model-tools';
import type { AgentModelConfiguration, AgentModelLimits } from './agent-model.config';
import type { ToolDefinition } from './tools/tool-definition';
import type { AIMessage } from '@langchain/core/messages';

/** Graph 一步模型输入；工具由服务端 selectAgentModelTools 选择，不接受模型自报版本。 */
export interface AgentModelStepRequest extends Omit<AgentModelRequest, 'messages'> {
  /** 完整的可见历史，包括已配对的工具调用与结果。 */
  messages: AgentModelMessage[];
  /** 本次可发现的可信定义快照；省略或空数组禁用工具调用。 */
  tools?: ToolDefinition[];
}

/** 模型只能提出下一步建议；tool_calls 必须进入已有持久化和授权执行链。 */
export type AgentModelDecision =
  | { /** 最终文本。 */ kind: 'answer'; /** 可见回答。 */ text: string }
  | { /** 工具调用提议。 */ kind: 'tool_calls'; /** 伴随文本，可为空。 */ text: string;
      /** 单步最多 8 个提议，不代表并发执行。 */ toolCalls: AgentModelToolCall[] };

export type AgentModelStepResult = AgentModelDecision & Omit<AgentModelResult, 'text'>;

/**
 * 解析供应商响应，判断模型意图：生成最终回答（answer）或请求调用工具（tool_calls）。
 *
 * 校验规则（严格拒绝，不降级）：
 * 1. 存在 invalid_tool_calls → 直接拒绝（供应商解析失败）。
 * 2. 无 tool_calls → 必须有非空文本回答，否则拒绝。
 * 3. 有 tool_calls → 数量 ≤8；如果无文本内容，content 必须为空字符串或空数组（不能有其他奇怪内容）。
 * 4. 每个 tool_call 必须有唯一 id，且名称必须在本次暴露的工具列表中。
 * 5. 所有 tool_call 参数经过 validateModelToolCall 结构校验。
 *
 * 不将坏调用降级成普通回答——如果模型输出的工具调用有问题，直接报错让运行层重试或终态。
 */
export function parseAgentModelDecision(response: Pick<AIMessage, 'content' | 'tool_calls' | 'invalid_tool_calls'>,
  tools: readonly ToolDefinition[]): AgentModelDecision {
  // 供应商解析失败的工具调用（如格式错误、缺少必要字段），直接拒绝。
  if (response.invalid_tool_calls?.length) throw new AgentModelError('AGENT_MODEL_OUTPUT_INVALID');
  const calls = response.tool_calls ?? [];
  const text = extractAgentModelText(response.content);

  // ── 分支一：模型没有请求工具调用 → 返回 answer ──
  if (!calls.length) {
    // 无 tool_calls 时必须有可见文本回答，不能是空内容。
    if (!text) throw new AgentModelError('AGENT_MODEL_OUTPUT_INVALID');
    return { kind: 'answer', text };
  }

  // ── 分支二：模型请求调用工具 → 多重校验 ──
  // 单步最多 8 个工具调用提议（不代表并发执行，只是模型一次提出的数量上限）。
  // 如果 text 为 null（extractAgentModelText 失败），content 必须为空字符串或空数组，不能有其他内容。
  if (calls.length > 8 || (text === null && response.content !== '' && !(Array.isArray(response.content) && response.content.length === 0))) {
    throw new AgentModelError('AGENT_MODEL_OUTPUT_INVALID');
  }

  const seen = new Set<string>();
  try {
    const toolCalls = calls.map((call) => {
      // call.id 必须存在且不重复；call.name 必须在本次暴露的工具列表中（模型不能调用没提供的工具）。
      if (!call.id || seen.has(call.id) || !tools.some((tool) => tool.name === call.name)) throw new AgentModelProtocolError();
      seen.add(call.id);
      // 参数结构校验：id 格式、name 格式、input 类型、JSON 深度、大小等。
      return validateModelToolCall({ id: call.id, name: call.name, input: call.args });
    });
    return { kind: 'tool_calls', text: text ?? '', toolCalls };
  } catch {
    // 统一包装：无论 validateModelToolCall 还是前面的校验失败，都输出稳定的 AGENT_MODEL_OUTPUT_INVALID。
    throw new AgentModelError('AGENT_MODEL_OUTPUT_INVALID');
  }
}

export interface AgentModelRequest {
  /** 已完成预算裁剪和权限隔离的消息。 */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; text: string }>;
  /** 本次最多生成 Token。 */
  maxOutputTokens: number;
  /** 单次调用超时毫秒，默认 60000，范围 1~300000。 */
  timeoutMs?: number;
  /** 上层取消时传入。 */
  signal?: AbortSignal;
}

export interface AgentModelResult {
  /** 模型生成的可见文本，不包含隐藏推理。 */
  text: string;
  /** 本次配置的模型标识。 */
  model: string;
  /** 供应商实际返回 Token 用量；未提供时为 null。 */
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  /** 本次模型调用耗时，单位毫秒。 */
  latencyMs: number;
}

/** 不包含请求/响应正文的调用观测数据。 */
export type AgentModelObservation = Omit<AgentModelResult, 'text'>;

/** 未返回或非法用量保留 null，不能转换成“免费”的零。 */
export function normalizeAgentTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Agent 模型错误统一到稳定内部代码，不向外泄漏供应商原始响应。 */
export class AgentModelError extends Error {
  /** 已收到响应时保留实际用量，即使文本或工具协议校验失败。 */
  readonly observation?: AgentModelObservation;
  readonly code: 'AGENT_MODEL_NOT_CONFIGURED' | 'INVALID_AGENT_MODEL_INPUT' | 'AGENT_MODEL_CALL_FAILED' | 'AGENT_MODEL_OUTPUT_INVALID' | 'AGENT_MODEL_CANCELLED' | 'AGENT_MODEL_TIMED_OUT';

  constructor(code: AgentModelError['code'], options?: { cause?: unknown; observation?: AgentModelObservation }) {
    super(code, options);
    this.name = 'AgentModelError';
    this.code = code;
    this.observation = options?.observation;
  }
}

/** 只接受文本响应；未来多模态由能力适配层显式扩展，不能 JSON.stringify 供应商原始包。 */
export function extractAgentModelText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') return null;
    const record = part as Record<string, unknown>;
    if (record.type !== 'text' || typeof record.text !== 'string') return null;
    parts.push(record.text);
  }
  const text = parts.join('').trim();
  return text || null;
}

@Injectable()
export class AgentModelClient {
  /** 启动时固定的配置快照；公开方法只返回副本，不暴露密钥。 */
  private readonly configuration: AgentModelConfiguration;

  constructor(private readonly configService: ConfigService) {
    this.configuration = loadAgentModelConfiguration(configService);
  }

  /** 当前模型的服务端预算，返回副本防止调用者修改启动配置。 */
  limits(): AgentModelLimits {
    return structuredClone(this.configuration.profiles[this.configuration.activeProfile]!.limits);
  }

  private configuredProfile() {
    const profile = this.configuration.profiles[this.configuration.activeProfile]!;
    const apiKey = this.configService.get<string>(profile.apiKeyEnv);
    return this.configuration.enabled && apiKey ? { ...profile, apiKey } : null;
  }

  /** 声明适配器支持的协议能力；不代表每个已配置供应商均支持 Tool Calling。 */
  capabilities(): { protocol: 'openai-compatible'; textGeneration: true; toolCalling: boolean; structuredOutput: false; streaming: false } {
    return { protocol: 'openai-compatible', textGeneration: true, toolCalling: this.configuration.profiles[this.configuration.activeProfile]!.toolCalling, structuredOutput: false, streaming: false };
  }

  /** 是否存在模型配置；不主动网络探测。 */
  isConfigured(): boolean {
    return this.configuredProfile() !== null;
  }

  /** 审计用模型标识；不返回地址、API Key 或供应商配置。 */
  configuredModel(): string | null {
    return this.configuredProfile()?.model ?? null;
  }

  /** 兼容既有纯文本入口；此入口不向模型暴露任何工具。 */
  async complete(request: AgentModelRequest): Promise<AgentModelResult> {
    const result = await this.step({ ...request, tools: [] });
    if (result.kind !== 'answer') throw new AgentModelError('AGENT_MODEL_OUTPUT_INVALID');
    return { text: result.text, model: result.model, usage: result.usage, latencyMs: result.latencyMs };
  }

  /**
   * 执行一次模型决策：向供应商发请求 → 解析响应 → 返回 answer 或 tool_calls。
   *
   * 设计边界：
   * - 只做"发请求+收响应"，不执行工具、不写 Run/Checkpoint、不隐藏循环/重试。
   * - 重试由 Graph 运行层协调，SDK 层 maxRetries=0 避免隐式增加费用。
   * - 所有异常统一为 AgentModelError，不泄漏供应商原始响应。
   */
  async step(request: AgentModelStepRequest): Promise<AgentModelStepResult> {
    // ── 阶段一：输入校验 ──
    if (!request || !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 8192) {
      throw new AgentModelError('INVALID_AGENT_MODEL_INPUT');
    }
    let messages;
    try { messages = toAgentModelMessages(request.messages); }
    catch { throw new AgentModelError('INVALID_AGENT_MODEL_INPUT'); }
    const tools = structuredClone(request.tools ?? []);
    if (tools.length > 32 || new Set(tools.map((tool) => tool.name)).size !== tools.length) {
      throw new AgentModelError('INVALID_AGENT_MODEL_INPUT');
    }
    const timeoutMs = request.timeoutMs ?? 60000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new AgentModelError('INVALID_AGENT_MODEL_INPUT');
    if (request.signal?.aborted) throw new AgentModelError('AGENT_MODEL_CANCELLED');

    // ── 阶段二：配置与预算校验 ──
    const cfg = this.configuredProfile();
    if (!cfg) throw new AgentModelError('AGENT_MODEL_NOT_CONFIGURED');
    // 上下文包括工具 Schema；估算只用于提前拒绝，不冒充供应商计费数据。
    const inputTokens = estimateAgentTokens(JSON.stringify({ messages: request.messages, tools })) + request.messages.length * 16;
    if (request.maxOutputTokens > cfg.limits.outputTokens || inputTokens + request.maxOutputTokens > cfg.limits.contextTokens ||
      (tools.length > 0 && !cfg.toolCalling)) throw new AgentModelError('INVALID_AGENT_MODEL_INPUT');
    const effectiveTimeout = Math.min(timeoutMs, cfg.timeoutMs);

    // ── 阶段三：构造供应商客户端 ──
    const model = new ChatOpenAI({
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: cfg.temperature,
      // 重试交由运行层协调，避免 SDK 隐式增加费用与尝试次数。
      maxRetries: 0,
      timeout: effectiveTimeout,
      maxTokens: request.maxOutputTokens,
      configuration: { baseURL: cfg.baseUrl },
    });

    // ── 阶段四：超时与取消信号合成 ──
    const startedAt = Date.now();
    const timeout = AbortSignal.timeout(effectiveTimeout);
    // 外部取消信号 + 内部超时信号合并：任一触发即中断请求。
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let observation: AgentModelObservation | undefined;

    // ── 阶段五：调用供应商 ──
    try {
      // 只发函数名称、说明、参数 Schema；权限、来源、版本和执行句柄不发送给供应商。
      const runnable = tools.length ? model.bindTools(tools.map((tool) => ({
        type: 'function' as const,
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })), { parallel_tool_calls: false }) : model;
      const response = await runnable.invoke(messages, { signal });
      const usage = response.usage_metadata;
      observation = {
        model: cfg.model,
        usage: {
          inputTokens: normalizeAgentTokenCount(usage?.input_tokens),
          outputTokens: normalizeAgentTokenCount(usage?.output_tokens),
          totalTokens: normalizeAgentTokenCount(usage?.total_tokens),
        },
        latencyMs: Date.now() - startedAt,
      };
      // 调用成功但信号已取消：模型可能返回部分结果，仍以取消处理，避免使用不完整输出。
      signal.throwIfAborted();
      return { ...parseAgentModelDecision(response, tools), ...observation };
    } catch (error) {
      // 异常分类：用户取消 > 超时 > 已知业务错误 > 其他网络/供应商错误。
      const code = request.signal?.aborted ? 'AGENT_MODEL_CANCELLED'
        : timeout.aborted || (error instanceof Error && error.name === 'APIConnectionTimeoutError') ? 'AGENT_MODEL_TIMED_OUT'
        : error instanceof AgentModelError ? error.code : 'AGENT_MODEL_CALL_FAILED';
      // observation 即使异常也保留（已收到响应时含用量数据），供审计层记录。
      throw new AgentModelError(code, { cause: error, observation });
    }
  }
}
