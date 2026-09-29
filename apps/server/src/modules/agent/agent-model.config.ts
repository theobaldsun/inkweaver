/** Agent 独立模型配置。只读取服务端指定文件；密钥通过环境变量引用，不写入文件或返回客户端。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ConfigService } from '@nestjs/config';

export interface AgentModelLimits {
  /** 单次输入与预留输出的上下文 Token 上限。 */
  contextTokens: number;
  /** 单次输出 Token 上限。 */
  outputTokens: number;
  /** 单 Run 最多调用次数，失败和未知结果也计数。 */
  callsPerRun: number;
  /** 每用户 UTC 自然日最多调用次数。 */
  callsPerUserDay: number;
  /** 单 Run 累计上下文额度；每次按 contextTokens 保守预占，不是计费 Token。 */
  reservedTokensPerRun: number;
  /** 每用户 UTC 自然日累计上下文额度；未知用量不返还额度。 */
  reservedTokensPerUserDay: number;
}

export interface AgentModelProfile {
  /** 适配器注册名；新增协议需实现对应适配器，不能只修改此字符串。 */
  adapter: 'openai-compatible';
  /** 服务端可信接口地址，不允许用户输入覆盖。 */
  baseUrl: string;
  /** 保存密钥的环境变量名，配置文件不接受明文密钥。 */
  apiKeyEnv: string;
  /** 供应商模型 ID。 */
  model: string;
  /** 该模型是否开放工具调用。 */
  toolCalling: boolean;
  /** 采样温度，范围 0~2。 */
  temperature: number;
  /** 单次超时毫秒，范围 1~300000。 */
  timeoutMs: number;
  /** 服务端强制调用预算。 */
  limits: AgentModelLimits;
}

export interface AgentModelConfiguration {
  /** 首版配置格式。 */
  schemaVersion: 1;
  /** 默认关闭；关闭时不得发起供应商请求。 */
  enabled: boolean;
  /** 当前配置名称。 */
  activeProfile: string;
  /** 可切换的模型配置集合。 */
  profiles: Record<string, AgentModelProfile>;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function integer(value: unknown, max = 1_000_000_000): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;
}

/** 严格校验完整文件；拼写错误、未知适配器和不合理预算均拒绝，不能静默回退到旧 AI 配置。 */
export function parseAgentModelConfiguration(value: unknown): AgentModelConfiguration {
  const fail = (): never => { throw new Error('INVALID_AGENT_MODEL_CONFIGURATION'); };
  if (!record(value) || !exact(value, ['schemaVersion', 'enabled', 'activeProfile', 'profiles']) || value.schemaVersion !== 1 ||
    typeof value.enabled !== 'boolean' || typeof value.activeProfile !== 'string' || !record(value.profiles)) return fail();
  if (!Object.hasOwn(value.profiles, value.activeProfile) || Object.keys(value.profiles).length > 32) return fail();
  for (const [name, p] of Object.entries(value.profiles)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || !record(p) ||
      !exact(p, ['adapter', 'baseUrl', 'apiKeyEnv', 'model', 'toolCalling', 'temperature', 'timeoutMs', 'limits']) ||
      p.adapter !== 'openai-compatible' || typeof p.baseUrl !== 'string' ||
      typeof p.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(p.apiKeyEnv) ||
      typeof p.model !== 'string' || !p.model.trim() || p.model.length > 256 || typeof p.toolCalling !== 'boolean' ||
      typeof p.temperature !== 'number' || !Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > 2 ||
      !integer(p.timeoutMs, 300000) || !record(p.limits)) return fail();
    let url: URL;
    try { url = new URL(p.baseUrl); } catch { return fail(); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return fail();
    const l = p.limits;
    if (!exact(l, ['contextTokens', 'outputTokens', 'callsPerRun', 'callsPerUserDay', 'reservedTokensPerRun', 'reservedTokensPerUserDay']) ||
      !Object.values(l).every((item) => integer(item)) || !integer(l.callsPerRun, 50) || !integer(l.contextTokens, 1_000_000) || !integer(l.outputTokens, 8192) ||
      Number(l.contextTokens) - Number(l.outputTokens) < 256 || Number(l.reservedTokensPerRun) < Number(l.contextTokens) ||
      Number(l.reservedTokensPerUserDay) < Number(l.contextTokens)) return fail();
  }
  return structuredClone(value) as unknown as AgentModelConfiguration;
}

/** 启动时读取配置快照；修改文件后重启服务生效，运行中不混用不同模型和预算。 */
export function loadAgentModelConfiguration(config: ConfigService): AgentModelConfiguration {
  const file = config.get<string>('AGENT_MODEL_CONFIG_FILE') ?? resolve(__dirname, '../../../config/agent-models.json');
  try { return parseAgentModelConfiguration(JSON.parse(readFileSync(file, 'utf8'))); }
  catch { throw new Error('INVALID_AGENT_MODEL_CONFIGURATION'); }
}
