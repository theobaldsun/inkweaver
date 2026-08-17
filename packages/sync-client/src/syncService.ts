/**
 * 同步客户端核心实现。
 *
 * 用途：
 * - 装配 syncEngine + socket.io + REST pull/push，提供统一的 SyncService 接口
 * - 通过 subscribeDocRoom 的引用计数模型，从根本上消除 join/leave 竞态
 *
 * 关键设计：
 * 1. 订阅模型：subscribeDocRoom 把"加入房间 + 注册监听 + 离开房间 + 反注册"封装为单一订阅。
 *    首个订阅者触发 emit('join-doc')，最后一个取消者触发 emit('leave-doc')。
 * 2. joinState 三态机：idle / pending / joined。
 *    - pending 表示 await connectSocket 进行中，期间所有订阅取消则回 idle，不 emit join-doc。
 *    - joined 表示已 emit join-doc，重连时由 socket.on('connect') 自动 rejoin。
 * 3. disposed 不污染接口：取消语义由内部 joinState 管理，调用方只需调用返回的 Unsubscribe。
 */

import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type * as Y from 'yjs';

import {
  base64ToUint8Array,
  uint8ArrayToBase64,
  base64ArrayToUint8ArrayArray,
  resolveSyncPullPage,
} from '@inkweaver/shared';
import { createSyncEngine, SYNC_REPLAY_ORIGIN } from '@inkweaver/sync-engine';
import type { SyncEngine } from '@inkweaver/sync-engine';
import type { LocalDB } from '@inkweaver/db-adapter';

import type {
  AuthServiceLike,
  DocumentApiLike,
  RemoteUpdateListener,
  SyncService,
  SyncServiceDeps,
  Unsubscribe,
} from './types';

/** 房间 join 状态机：idle 空闲 / pending join 进行中 / joined 已 emit join-doc */
type JoinState = 'idle' | 'pending' | 'joined';

/** 单条 docId 的运行时上下文 */
interface DocRoomContext {
  /** 当前 join 状态 */
  state: JoinState;
  /** 订阅者集合；引用计数来源 */
  listeners: Set<RemoteUpdateListener>;
}

/**
 * 创建同步服务实例。
 *
 * 输入：SyncServiceDeps（依赖注入 localDB / authService / documentApi / socketUrl / clientId）
 * 输出：SyncService
 */
export function createSyncService(deps: SyncServiceDeps): SyncService {
  const {
    localDB,
    authService,
    documentApi,
    socketUrl,
    clientId,
    socketConnectTimeoutMs = 5000,
  } = deps;

  /** socket 实例（懒初始化） */
  let socket: Socket | null = null;

  /** 每个 docId 的房间上下文（join 状态 + 订阅者集合） */
  const docRooms = new Map<string, DocRoomContext>();

  /** 连接状态订阅者 */
  const connectionListeners = new Set<(connected: boolean) => void>();

  /** 冲突信号订阅者 */
  const conflictListeners = new Set<(docId: string) => void>();

  /**
   * REST pull/push 适配器：把 documentApi 的字符串 updates 编解码为 Uint8Array。
   * 失败时抛错，避免 syncEngine 误判为"无增量"。
   */
  const apiClient = {
    /**
     * 分页拉取远端更新。
     * 失败重试 3 次（指数退避），总超时 120s；仅"还有更多数据"时才检查超时。
     */
    async pull(
      docId: string,
      cursor?: number,
      limit?: number,
      snapshotVersion?: number,
    ): Promise<{
      updates: Uint8Array[];
      nextCursor: number;
      hasMore: boolean;
      snapshot?: Uint8Array;
      latestUpdateId?: number;
    }> {
      const allUpdates: Uint8Array[] = [];
      let currentCursor = cursor ?? 0;
      let hasMoreData = true;
      let snapshotResult: Uint8Array | undefined;
      let retryCount = 0;
      const maxRetries = 3;
      const maxExecutionTime = 120000;
      let iterationCount = 0;
      let latestUpdateId = cursor ?? 0;
      const startTime = Date.now();

      while (
        hasMoreData &&
        retryCount < maxRetries &&
        Date.now() - startTime < maxExecutionTime
      ) {
        try {
          iterationCount++;
          const response = await documentApi.syncPull({
            docId,
            cursor: currentCursor,
            limit: limit ?? 100,
            snapshotVersion,
          });

          if (!response || !Array.isArray(response.updates)) {
            retryCount++;
            if (retryCount >= maxRetries) {
              throw new Error('Sync pull 返回非法响应且重试耗尽');
            }
            await delay(Math.pow(2, retryCount) * 1000);
            continue;
          }

          // 首次迭代才接受 snapshot，避免后续覆盖
          if (iterationCount === 1 && response.snapshot) {
            snapshotResult = base64ToUint8Array(response.snapshot);
          }

          const updates = response.updates.map((u: string) =>
            base64ToUint8Array(u),
          );
          allUpdates.push(...updates);

          const progress = resolveSyncPullPage(currentCursor, {
            updateCount: updates.length,
            nextCursor: response.nextCursor,
            hasMore: response.hasMore,
            latestUpdateId: response.latestUpdateId,
          });
          currentCursor = progress.nextCursor;
          latestUpdateId = progress.latestUpdateId;
          hasMoreData = progress.shouldContinue;
          retryCount = 0;

          if (!hasMoreData) break;
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw error instanceof Error
              ? error
              : new Error('Sync pull failed after max retries');
          }
          await delay(Math.pow(2, retryCount) * 1000);
        }
      }

      // 修复 WEB-P2-01：成功完成（hasMoreData=false）时不再误判超时
      if (hasMoreData && Date.now() - startTime >= maxExecutionTime) {
        throw new Error('Sync pull exceeded max execution time');
      }

      return {
        updates: allUpdates,
        nextCursor: currentCursor,
        hasMore: false,
        latestUpdateId,
        snapshot: snapshotResult,
      };
    },

    /** 推送本地 updates 到服务端，返回新的 latestUpdateId */
    async push(
      docId: string,
      updates: Uint8Array[],
      baseUpdateId?: number,
    ): Promise<{ latestUpdateId?: number }> {
      if (updates.length === 0) return { latestUpdateId: baseUpdateId };
      const base64Updates = updates.map((u) => uint8ArrayToBase64(u));
      const response = await documentApi.syncPush({
        docId,
        updates: base64Updates,
        clientId,
        baseUpdateId,
      });
      return { latestUpdateId: response.latestUpdateId };
    },
  };

  const syncEngine: SyncEngine = createSyncEngine({
    localDB,
    api: apiClient,
    clientId,
  });

  /** 通知所有连接状态订阅者 */
  const notifyConnectionChange = (connected: boolean) => {
    connectionListeners.forEach((listener) => listener(connected));
  };

  /**
   * 懒初始化 socket 实例并绑定全局事件。
   * 仅在首次调用时创建，后续返回同一实例。
   */
  const initSocket = (): Socket => {
    if (socket) return socket;

    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: socketConnectTimeoutMs,
    });

    // 重连后只 rejoin 仍处于 joined 状态的房间（服务端 join-doc 会踢掉其它 doc 房间）
    socket.on('connect', () => {
      notifyConnectionChange(true);
      docRooms.forEach((ctx, docId) => {
        if (ctx.state === 'joined') {
          socket?.emit('join-doc', { docId });
        }
      });
    });

    socket.on('disconnect', () => {
      notifyConnectionChange(false);
    });

    // 收到远端 update 广播：解码后分发给该 docId 的所有监听器
    socket.on('update', ({ docId, data }) => {
      // REST 广播会进本机房间：忽略本 clientId，避免把刚 push 的 updates 回灌
      if (data?.clientId && data.clientId === clientId) {
        return;
      }
      const ctx = docRooms.get(docId);
      if (ctx && data.updates) {
        const decoded = base64ArrayToUint8ArrayArray(data.updates);
        ctx.listeners.forEach((listener) => listener(decoded));
      }
    });

    // 仅通知页面；由页面触发一次 syncDocument，避免双重全量同步
    socket.on('conflict', ({ docId }: { docId: string }) => {
      if (!docId) return;
      conflictListeners.forEach((cb) => cb(docId));
    });

    return socket;
  };

  /**
   * 建立 socket 连接（带 token）。
   * 已连接则立即 resolve；否则等待 connect 事件或超时。
   */
  const connectSocket = (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const connectWithToken = async () => {
        const tokens = await authService.getTokens();
        const s = initSocket();
        s.auth = { token: tokens?.access_token ?? '' };

        if (s.connected) {
          // 已连接时也刷新 auth（token 可能在期间被更新）
          resolve();
          return;
        }

        const timer = setTimeout(() => {
          s.off('connect', onConnect);
          s.off('connect_error', onError);
          reject(new Error('WebSocket 连接超时'));
        }, socketConnectTimeoutMs);

        const onConnect = () => {
          clearTimeout(timer);
          s.off('connect_error', onError);
          resolve();
        };

        const onError = (err: Error) => {
          clearTimeout(timer);
          s.off('connect', onConnect);
          reject(err);
        };

        s.once('connect', onConnect);
        s.once('connect_error', onError);
        s.connect();
      };

      connectWithToken().catch(reject);
    });
  };

  /**
   * 真正 emit join-doc 并把状态从 pending 推进到 joined。
   * 若 await connectSocket 期间状态被 unsubscribe 改回 idle，则不 emit。
   */
  const joinDocRoomInternal = async (docId: string): Promise<void> => {
    try {
      await connectSocket();
      const ctx = docRooms.get(docId);
      // 期间被取消（所有订阅者离开）则不 emit join-doc
      if (!ctx || ctx.state !== 'pending') return;
      socket?.emit('join-doc', { docId });
      ctx.state = 'joined';
    } catch (error) {
      // 连接失败：状态回 idle，下次订阅会重试
      const ctx = docRooms.get(docId);
      if (ctx && ctx.state === 'pending') {
        ctx.state = 'idle';
      }
      console.warn('WebSocket 未连接，将仅使用 REST 同步:', error);
    }
  };

  /**
   * 真正 emit leave-doc 并清理房间上下文。
   * 仅在 joined 状态下 emit；pending / idle 状态静默处理。
   */
  const leaveDocRoomInternal = (docId: string): void => {
    const ctx = docRooms.get(docId);
    if (!ctx) return;

    if (ctx.state === 'joined') {
      try {
        if (socket?.connected) {
          socket.emit('leave-doc', { docId });
        }
      } catch (error) {
        console.warn('leave-doc 失败:', error);
      }
    }
    // pending 状态：无需 emit leave-doc（本就没 join），joinDocRoomInternal 会自检 state
    docRooms.delete(docId);
  };

  /**
   * 订阅指定文档的实时更新房间。
   *
   * 竞态修复核心：
   * - 先注册 listener 并把 ctx.state 置为 pending（首个订阅者），再异步 connectSocket
   * - 取消订阅时 listener 从 set 移除；set 空时若 state=pending 则回 idle（joinDocRoomInternal 自检不 emit）
   * - set 空时若 state=joined 则 emit leave-doc
   */
  const subscribeDocRoom = (
    docId: string,
    onUpdate: RemoteUpdateListener,
  ): Unsubscribe => {
    let ctx = docRooms.get(docId);
    if (!ctx) {
      ctx = { state: 'idle', listeners: new Set() };
      docRooms.set(docId, ctx);
    }
    ctx.listeners.add(onUpdate);

    // 首个订阅者触发 join
    if (ctx.state === 'idle') {
      ctx.state = 'pending';
      void joinDocRoomInternal(docId);
    }

    return () => {
      const current = docRooms.get(docId);
      if (!current) return;
      current.listeners.delete(onUpdate);

      // 引用计数归零：清理房间
      if (current.listeners.size === 0) {
        leaveDocRoomInternal(docId);
      }
    };
  };

  /** 全量同步文档（透传 syncEngine.syncDoc） */
  const syncDocument = async (docId: string): Promise<void> => {
    await syncEngine.syncDoc(docId);
  };

  /** 获取或创建 Yjs 文档实例（透传 syncEngine.getYDoc） */
  const getYDoc = (docId: string): Y.Doc => syncEngine.getYDoc(docId);

  /** 清理 Yjs 文档缓存（透传 syncEngine.clearYDocCache） */
  const clearYDocCache = (docId: string): void => {
    syncEngine.clearYDocCache(docId);
  };

  /** 注册同步冲突回调 */
  const onSyncConflict = (callback: (docId: string) => void): Unsubscribe => {
    conflictListeners.add(callback);
    return () => conflictListeners.delete(callback);
  };

  /** 订阅 socket 连接状态变化；订阅时立即触发一次当前状态 */
  const onConnectionChange = (
    callback: (connected: boolean) => void,
  ): Unsubscribe => {
    connectionListeners.add(callback);
    callback(isWebSocketConnected());
    return () => connectionListeners.delete(callback);
  };

  /** 当前 socket 是否连接 */
  const isWebSocketConnected = (): boolean => socket?.connected ?? false;

  /**
   * 断开 socket 连接并清理所有房间状态。
   *
   * 调用时机：用户登出时调用，防止旧 token 持有连接。
   * 登出后若用户重新登录，connectSocket 会以新 token 建立全新连接。
   */
  const disconnectSocket = (): void => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    docRooms.clear();
    notifyConnectionChange(false);
  };

  return {
    subscribeDocRoom,
    syncDocument,
    getYDoc,
    clearYDocCache,
    onSyncConflict,
    onConnectionChange,
    isWebSocketConnected,
    disconnectSocket,
    get syncEngine() {
      return syncEngine;
    },
    get localDB() {
      return localDB;
    },
    get clientId() {
      return clientId;
    },
    get SYNC_REPLAY_ORIGIN() {
      return SYNC_REPLAY_ORIGIN;
    },
  };
}

/** 工具：延迟 ms 毫秒 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// 显式重新导出 SYNC_REPLAY_ORIGIN，方便调用方从 sync-client 直接取
export { SYNC_REPLAY_ORIGIN };
