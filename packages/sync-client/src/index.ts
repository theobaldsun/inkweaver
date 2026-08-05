/**
 * 同步客户端包入口。
 *
 * 用途：
 * - 装配 syncEngine + socket.io + REST pull/push 的"客户端同步服务"
 * - 通过 subscribeDocRoom 引用计数模型提供无竞态的房间订阅
 *
 * 依赖注入：
 * - localDB / authService / documentApi / socketUrl / clientId 由 apps 层提供
 * - 本包不依赖任何平台特定的存储实现，可在 web / h5 / mobile 复用
 */

export { createSyncService, SYNC_REPLAY_ORIGIN } from './syncService';
export type {
  AuthServiceLike,
  DocumentApiLike,
  RemoteUpdateListener,
  SyncService,
  SyncServiceDeps,
  Unsubscribe,
} from './types';
