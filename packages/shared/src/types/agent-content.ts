/**
 * Agent 内容契约 v1：供消息、工具结果和成果复用，不依赖模型或编排框架。
 * 类型可表达媒体不代表服务已开放对应能力；资源归属、大小和实际媒体类型
 * 必须由服务端校验。资源引用不存放本地路径、凭据或签名 URL。
 */

/** 首版内容契约版本，供未来消息或事件信封引用。 */
export type AgentContentContractVersion = 1;

/** 资源处理状态；ready 仅表示处理完成，不表示当前用户有访问权限。 */
export type AgentAssetStatus = "pending" | "processing" | "ready" | "failed";

/** 服务端资源引用；下载地址应在读取时经过鉴权单独获取。 */
export interface AgentAssetRef {
  /** 服务端分配的不透明资源 ID，不得使用文件路径或 URL 代替。 */
  assetId: string;
  /** MIME 类型；服务端须检查真实内容，不能信任客户端声明。 */
  mimeType: string;
  /** 资源原始大小，单位为字节；服务端须校验为非负安全整数。 */
  sizeBytes: number;
  /** 资源当前处理状态，不承载具体供应商错误或敏感信息。 */
  status: AgentAssetStatus;
}

/** 文本直接承载正文；never 字段阻止已有变量混用文本与资源载荷。 */
export interface AgentTextBlock {
  /** 内容块类型。 */
  type: "text";
  /** 文本正文；不代表可信指令，信任层级由消息上下文确定。 */
  text: string;
  /** 文本块不携带资源；必须省略。 */
  asset?: never;
}

/** 图片只保存资源引用，不将二进制或 Base64 放入消息。 */
export interface AgentImageBlock {
  /** 内容块类型。 */
  type: "image";
  /** 图片资源；MIME 前缀只提供静态约束，不替代内容检查。 */
  asset: AgentAssetRef & { mimeType: `image/${string}` };
  /** 媒体块不携带文本正文；必须省略。 */
  text?: never;
}

/** 音频输入与输出共用引用契约，不绑定转写或实时传输协议。 */
export interface AgentAudioBlock {
  /** 内容块类型。 */
  type: "audio";
  /** 音频资源；转写结果应使用独立文本块。 */
  asset: AgentAssetRef & { mimeType: `audio/${string}` };
  /** 媒体块不携带文本正文；必须省略。 */
  text?: never;
}

/** 通用文件引用，具体文件格式及能力允许列表由服务端控制。 */
export interface AgentFileBlock {
  /** 内容块类型。 */
  type: "file";
  /** 文件资源，允许任意 MIME 类型表达，不代表允许上传或执行。 */
  asset: AgentAssetRef;
  /** 文件块不携带文本正文；必须省略。 */
  text?: never;
}

/** 使用 type 收窄载荷；新增类型时消费者应显式处理或拒绝。 */
export type AgentContentBlock =
  | AgentTextBlock
  | AgentImageBlock
  | AgentAudioBlock
  | AgentFileBlock;
