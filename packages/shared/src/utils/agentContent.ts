/**
 * Agent 内容块 v1 的运行时解析：严格检查字段并返回独立副本。
 * 输入面向 JSON 解码后的数据；此处不查询资源、不鉴权，也不证明 MIME、
 * 大小或处理状态真实。服务端执行前仍须读取权威资源记录并检查模型能力。
 */
import type { AgentAssetRef, AgentContentBlock } from "../types/agent-content";

/** 稳定错误码，便于调用方映射 UI 或 HTTP 错误，不回显输入内容。 */
export type AgentContentErrorCode =
  | "INVALID_BLOCK"
  | "UNSUPPORTED_TYPE"
  | "TYPE_DISABLED"
  | "INVALID_TEXT"
  | "INVALID_ASSET";

/** 解析成功才返回新的类型化载荷；失败不附带可能含凭据的原始数据。 */
export type AgentContentParseResult =
  | { /** 是否成功。 */ ok: true; /** 解析后的独立内容块。 */ value: AgentContentBlock }
  | { /** 是否成功。 */ ok: false; /** 可供调用方分流的错误码。 */ code: AgentContentErrorCode };

/** 调用方的功能开放策略；应来自可信配置，不应直接使用用户提交的配置。 */
export interface AgentContentParseOptions {
  /** 允许的内容类型；省略时仅允许文本，空数组表示全部关闭。 */
  enabledTypes?: readonly AgentContentBlock["type"][];
}

/** 只接受普通数据对象，拒绝数组及带自定义原型的实例。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 字段必须完整且无额外键；拒绝访问器，避免读取时触发用户代码。 */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && keys.includes(key) && descriptor !== undefined && "value" in descriptor;
  });
}

/** 资源 ID 使用 URL 安全的不透明标识（兼容 UUID），不接受路径或地址。 */
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** 使用规范化的小写 MIME essence；参数和通配符不是资源的具体媒体类型。 */
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function parseAsset(value: unknown): AgentAssetRef | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["assetId", "mimeType", "sizeBytes", "status"])) return;
  const { assetId, mimeType, sizeBytes, status } = value;
  if (typeof assetId !== "string" || !ASSET_ID_PATTERN.test(assetId)) return;
  if (typeof mimeType !== "string" || !MIME_PATTERN.test(mimeType)) return;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return;
  if (status !== "pending" && status !== "processing" && status !== "ready" && status !== "failed") return;
  return { assetId, mimeType, sizeBytes, status };
}

/**
 * 解析单个内容块，不执行隐式类型转换或静默删除额外字段。
 * 媒体默认关闭；显式开启仅表示允许表达该载荷，不代表上传、模型支持或访问授权。
 * 空文本和零字节资源在基础契约中合法，具体业务限制由调用方另外执行。
 * @param input JSON 解码后的待验证内容块。
 * @param options 可信的内容类型开放策略。
 */
export function parseAgentContentBlock(
  input: unknown,
  options: AgentContentParseOptions = {},
): AgentContentParseResult {
  if (!isRecord(input)) return { ok: false, code: "INVALID_BLOCK" };
  const typeDescriptor = Object.getOwnPropertyDescriptor(input, "type");
  if (!typeDescriptor || !("value" in typeDescriptor)) return { ok: false, code: "INVALID_BLOCK" };
  const type: unknown = typeDescriptor.value;
  if (type !== "text" && type !== "image" && type !== "audio" && type !== "file") {
    return { ok: false, code: "UNSUPPORTED_TYPE" };
  }
  if (!hasExactKeys(input, type === "text" ? ["type", "text"] : ["type", "asset"])) {
    return { ok: false, code: "INVALID_BLOCK" };
  }
  if (!(options.enabledTypes ?? ["text"]).includes(type)) return { ok: false, code: "TYPE_DISABLED" };
  if (type === "text") {
    return typeof input.text === "string"
      ? { ok: true, value: { type, text: input.text } }
      : { ok: false, code: "INVALID_TEXT" };
  }
  const asset = parseAsset(input.asset);
  if (!asset) return { ok: false, code: "INVALID_ASSET" };
  // MIME 前缀验证后才收窄模板字符串类型；不凭静态断言绕过检查。
  if (type === "image") {
    if (!asset.mimeType.startsWith("image/")) return { ok: false, code: "INVALID_ASSET" };
    return { ok: true, value: { type, asset: { ...asset, mimeType: asset.mimeType as `image/${string}` } } };
  }
  if (type === "audio") {
    if (!asset.mimeType.startsWith("audio/")) return { ok: false, code: "INVALID_ASSET" };
    return { ok: true, value: { type, asset: { ...asset, mimeType: asset.mimeType as `audio/${string}` } } };
  }
  return { ok: true, value: { type, asset } };
}
