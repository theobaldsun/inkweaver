/**
 * 同步引擎包入口（基于 Yjs CRDT）。
 *
 * 用途：
 * - 基于 Yjs 实现自动冲突合并
 * - 支持离线编辑和多端同步
 * - 提供统一的同步接口
 *
 * 输入：本地存储实现、API 客户端、客户端 ID
 * 输出：同步结果和 Yjs 文档实例
 */

export type {
  SyncEngine,
  SyncEngineOptions,
} from "./syncEngine";
export { createSyncEngine, SYNC_REPLAY_ORIGIN } from "./syncEngine";
