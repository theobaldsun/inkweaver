/**
 * 编译期契约校验：刻意不使用 .test.ts，以纳入现有 shared typecheck。
 * 不从包入口导出，不进入发布 bundle；@ts-expect-error 在约束失效时会报错。
 * TypeScript 为结构化类型系统，不能替代网络输入的运行时字段过滤和鉴权。
 */
import type {
  AgentAssetRef,
  AgentContentBlock,
  AgentContentContractVersion,
} from "../index";

const asset = {
  assetId: "asset-1",
  mimeType: "image/png",
  sizeBytes: 128,
  status: "ready",
} as const satisfies AgentAssetRef;

const _version: AgentContentContractVersion = 1;
// @ts-expect-error 首版不接受其他契约版本。
const _futureVersion: AgentContentContractVersion = 2;

const _blocks: AgentContentBlock[] = [
  { type: "text", text: "正文" },
  { type: "image", asset },
  { type: "audio", asset: { ...asset, mimeType: "audio/wav" } },
  { type: "file", asset: { ...asset, mimeType: "application/pdf" } },
];

/** 验证每个分支的载荷收窄及穷尽性，新类型加入时必须更新该校验。 */
function _narrow(block: AgentContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image": {
      const mime: `image/${string}` = block.asset.mimeType;
      return mime;
    }
    case "audio": {
      const mime: `audio/${string}` = block.asset.mimeType;
      return mime;
    }
    case "file":
      return block.asset.assetId;
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

// @ts-expect-error 媒体必须携带资源引用。
const _missingAsset: AgentContentBlock = { type: "image" };
// @ts-expect-error 文本必须携带正文。
const _missingText: AgentContentBlock = { type: "text" };
const mixed = { type: "text", text: "正文", asset } as const;
// @ts-expect-error 即使载荷来自已有变量，也不能混用文本与资源。
const _mixed: AgentContentBlock = mixed;
// @ts-expect-error 图片不能引用音频 MIME。
const _wrongMime: AgentContentBlock = { type: "image", asset: { ...asset, mimeType: "audio/wav" } };
// @ts-expect-error 媒体不能以内联文本代替独立内容块。
const _mediaText: AgentContentBlock = { type: "audio", asset: { ...asset, mimeType: "audio/wav" }, text: "转写" };
// @ts-expect-error 未定义的内容类型必须显式扩展契约。
const _unknown: AgentContentBlock = { type: "video", asset };
// @ts-expect-error 状态必须来自规定集合。
const _status: AgentAssetRef = { ...asset, status: "uploaded" };
// @ts-expect-error 字节大小不是字符串。
const _size: AgentAssetRef = { ...asset, sizeBytes: "128" };
// @ts-expect-error 不允许在引用字面量中持久化签名 URL。
const _url: AgentAssetRef = { ...asset, url: "https://example.invalid/signed" };
// @ts-expect-error 不允许在引用字面量中放入本地路径。
const _path: AgentAssetRef = { ...asset, path: "/private/file" };
// @ts-expect-error 不允许在引用字面量中放入凭据。
const _credentials: AgentAssetRef = { ...asset, credentials: "secret-placeholder" };
