/**
 * H5 端同步服务装配。
 *
 * 用途：
 * - 把平台相关依赖（web LocalDB / authService / documentApi / socketUrl / clientId）
 *   注入 @inkweaver/sync-client 的 createSyncService 工厂
 * - 重新导出 SyncService 实例的字段，供 apps/h5 内部模块使用
 *
 * 注意：
 * - 房间订阅统一通过 subscribeDocRoom（引用计数模型，已修复 join/leave 竞态）
 * - 不再直接暴露 joinDocRoom / leaveDocRoom / onUpdate / offUpdate
 */

import { documentApi } from '@inkweaver/api';
import { createWebLocalDB } from '@inkweaver/db-adapter/web';
import { authService } from '@inkweaver/services';
import { createSyncService } from '@inkweaver/sync-client';

import { SYNC_SOCKET_URL } from '../config/env';

/** 当前客户端唯一标识；进程内复用 */
export const CLIENT_ID = `client-${Date.now()}-${Math.random()
  .toString(36)
  .substr(2, 9)}`;

/** 装配同步服务实例 */
const syncService = createSyncService({
  localDB: createWebLocalDB(),
  authService,
  documentApi,
  socketUrl: SYNC_SOCKET_URL,
  clientId: CLIENT_ID,
});

/** 重新导出供 apps/h5 内部模块使用 */
export const {
  subscribeDocRoom,
  syncDocument,
  getYDoc,
  clearYDocCache,
  onSyncConflict,
  onConnectionChange,
  isWebSocketConnected,
  syncEngine,
  localDB,
  SYNC_REPLAY_ORIGIN,
} = syncService;
