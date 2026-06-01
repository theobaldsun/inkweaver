/**
 * 同步引擎核心类型定义。
 *
 * 用途：
 * - 作为“黑盒”同步引擎对外契约（Contract）
 * - 强制平台实现遵循统一接口，降低耦合
 *
 * 输入：类型定义本身（编译期）
 * 输出：类型检查结果（编译期）
 */

export type EntityId = string;

export interface Change {
  /**
   * 变更所属实体（文档/块/附件等）。
   */
  entityId: EntityId;
  /**
   * 变更的递增序号或逻辑时钟（平台侧生成）。
   */
  seq: number;
  /**
   * 变更 payload（建议为小粒度 patch；MVP 可用整文档快照）。
   */
  payload: unknown;
  /**
   * 变更发生时间（用于调试/降级策略，不作为强一致依据）。
   */
  timestampMs: number;
}

export interface PushResult {
  /**
   * 服务端确认已接收的最大 seq。
   */
  ackSeq: number;
}

export interface PullResult {
  /**
   * 从服务端拉取到的变更列表（按时间或 seq 排序）。
   */
  changes: Change[];
}

export interface LocalStore {
  /**
   * 获取本地未上行的变更。
   *
   * 输入：从哪个 seq 之后开始取（不含）
   * 输出：变更数组
   */
  getPendingChanges: (afterSeq: number) => Promise<Change[]>;

  /**
   * 写入从服务端拉取的变更（或冲突解决后的变更）。
   *
   * 输入：变更数组
   * 输出：写入成功与否（异常表示失败）
   */
  applyRemoteChanges: (changes: Change[]) => Promise<void>;

  /**
   * 提交已被服务端确认的变更（从 pending 队列移除/更新水位）。
   *
   * 输入：ackSeq
   * 输出：无
   */
  commitAck: (ackSeq: number) => Promise<void>;

  /**
   * 获取本地已提交的最大 seq（同步水位）。
   *
   * 输入：无
   * 输出：最大 seq（无则为 0）
   */
  getLastAckSeq: () => Promise<number>;
}

export interface SyncTransport {
  /**
   * 推送本地变更到服务端。
   *
   * 输入：changes
   * 输出：PushResult（ackSeq）
   */
  push: (changes: Change[]) => Promise<PushResult>;
  /**
   * 从服务端拉取远端变更。
   *
   * 输入：afterSeq（客户端已应用的水位）
   * 输出：PullResult
   */
  pull: (afterSeq: number) => Promise<PullResult>;
}

export interface SyncEngineOptions {
  /**
   * 本地存储适配器。
   */
  localStore: LocalStore;
  /**
   * 网络传输适配器（REST/WebSocket 皆可由调用方实现）。
   */
  transport: SyncTransport;
  /**
   * 每次 push 的最大变更数量。
   */
  pushBatchSize?: number;
}

export interface SyncEngine {
  /**
   * 执行一次“push + pull”的同步循环。
   *
   * 输入：无
   * 输出：本次同步是否做了远端应用（changes 数量）
   */
  syncOnce: () => Promise<{ pushed: number; pulled: number }>;
}

