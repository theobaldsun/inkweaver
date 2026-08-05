/**
 * 同步客户端类型定义。
 *
 * 用途：
 * - 声明 createSyncService 工厂所需的依赖契约（依赖注入）
 * - 声明 SyncService 对外暴露的接口形状
 *
 * 设计原则：
 * - 依赖最小化：仅约束实际使用到的字段/方法，避免绑架调用方
 * - 平台无关：不直接引用 dexie / AsyncStorage，由调用方注入 LocalDB
 */

import type { LocalDB } from '@inkweaver/db-adapter';
import type { SyncEngine } from '@inkweaver/sync-engine';
import type { LoginResponse } from '@inkweaver/shared';
import type * as Y from 'yjs';

/**
 * authService 的最小契约。
 * 实际的 @inkweaver/services.authService 满足此契约。
 */
export interface AuthServiceLike {
  /** 获取当前缓存的登录令牌；未登录返回 null */
  getTokens(): Promise<(LoginResponse & { userId: string }) | null>;
}

/**
 * documentApi.syncPull / syncPush 的最小契约。
 * 实际的 @inkweaver/api.documentApi 满足此契约。
 */
export interface DocumentApiLike {
  syncPull(request: {
    docId: string;
    cursor?: number;
    limit?: number;
    snapshotVersion?: number;
  }): Promise<{
    updates: string[];
    nextCursor: number;
    hasMore: boolean;
    snapshot?: string;
    latestUpdateId?: number;
  }>;
  syncPush(request: {
    docId: string;
    updates: string[];
    clientId?: string;
    baseUpdateId?: number;
  }): Promise<{
    success: boolean;
    latestUpdateId?: number;
    updateIds?: number[];
  }>;
}

/**
 * 创建同步服务所需的依赖。
 *
 * 由 apps 层注入：
 * - localDB：web 用 createWebLocalDB()，mobile 用 AsyncStorage 包装
 * - authService / documentApi：直接从 @inkweaver/services、@inkweaver/api 导入
 * - socketUrl：从各端 config/env 提供
 * - clientId：建议各端生成一次并复用
 */
export interface SyncServiceDeps {
  /** 本地存储适配器（IndexedDB / AsyncStorage 等） */
  localDB: LocalDB;
  /** 鉴权服务，用于读取 access_token 装配 socket.auth */
  authService: AuthServiceLike;
  /** 文档 API，用于 REST pull/push */
  documentApi: DocumentApiLike;
  /** Socket.io 网关地址 */
  socketUrl: string;
  /** 当前客户端唯一标识，用于过滤回声与服务端推送广播 */
  clientId: string;
  /** socket 连接超时（毫秒），默认 5000 */
  socketConnectTimeoutMs?: number;
}

/**
 * 远端更新回调签名。
 * 收到的 updates 已从 base64 解码为 Uint8Array。
 */
export type RemoteUpdateListener = (updates: Uint8Array[]) => void;

/**
 * 房间订阅的取消函数。
 * 调用后：
 * - 反注册该监听器
 * - 当该 docId 的最后一个监听器离开时，emit leave-doc 并从 docRooms 移除
 */
export type Unsubscribe = () => void;

/**
 * 同步服务对外暴露的接口。
 *
 * 设计要点：
 * - subscribeDocRoom 把"加入房间 + 注册监听 + 离开房间 + 反注册"封装为单一订阅模型，
 *   通过引用计数决定何时真正 emit join-doc / leave-doc，从根本上消除 join/leave 竞态。
 * - 其他方法（syncDocument / getYDoc 等）仅为装配 syncEngine 与 localDB 的便捷透传。
 */
export interface SyncService {
  /**
   * 订阅指定文档的实时更新房间。
   *
   * 行为：
   * - 首个订阅者触发 connectSocket + emit('join-doc')
   * - 后续订阅者复用已 join 的房间，仅注册监听
   * - 取消订阅时反注册；最后一个取消者触发 emit('leave-doc')
   * - await connectSocket 期间被取消（disposed）则不会 emit join-doc，避免"加入后立即离开"竞态
   *
   * @returns 取消订阅函数
   */
  subscribeDocRoom(docId: string, onUpdate: RemoteUpdateListener): Unsubscribe;

  /** 全量同步文档（pull + push），由页面在进入或冲突时触发 */
  syncDocument(docId: string): Promise<void>;
  /** 获取或创建 Yjs 文档实例（来自 syncEngine） */
  getYDoc(docId: string): Y.Doc;
  /** 清理 Yjs 文档缓存（来自 syncEngine） */
  clearYDocCache(docId: string): void;

  /** 注册同步冲突回调（如编辑页收到 conflict 信号后刷新） */
  onSyncConflict(callback: (docId: string) => void): Unsubscribe;
  /** 订阅 Socket.io 连接状态变化 */
  onConnectionChange(callback: (connected: boolean) => void): Unsubscribe;
  /** 当前 socket 是否处于连接状态 */
  isWebSocketConnected(): boolean;

  /** 底层同步引擎，供页面透传使用 */
  readonly syncEngine: SyncEngine;
  /** 本地存储适配器，供页面透传使用 */
  readonly localDB: LocalDB;
  /** 当前客户端 ID */
  readonly clientId: string;
  /** Yjs 同步回放 origin（避免本地监听器把远端更新当作本地编辑） */
  readonly SYNC_REPLAY_ORIGIN: string;
}
