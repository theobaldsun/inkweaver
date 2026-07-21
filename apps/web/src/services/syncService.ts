/**
 * Web 端同步服务。
 *
 * 用途：封装 REST pull/push、Socket 房间加入/离开、冲突通知与 sync-engine。
 * 输入：docId、Yjs updates
 * 输出：同步结果；副作用为本地 DB 与远端同步
 */

import { documentApi } from '@inkweaver/api';
import { createWebLocalDB } from '@inkweaver/db-adapter/web';
import { authService } from '@inkweaver/services';
import {
  base64ToUint8Array,
  uint8ArrayToBase64,
  base64ArrayToUint8ArrayArray,
  resolveSyncPullPage,
} from '@inkweaver/shared';
import { createSyncEngine, SYNC_REPLAY_ORIGIN } from '@inkweaver/sync-engine';
import { io } from 'socket.io-client';

import { SYNC_SOCKET_URL } from '../config/env';

import type { Socket } from 'socket.io-client';
import type * as Y from 'yjs';

export const CLIENT_ID = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/** WebSocket 连接超时（毫秒），失败不阻塞文档加载 */
const SOCKET_CONNECT_TIMEOUT_MS = 5000;

let socket: Socket | null = null;
const updateListeners = new Map<string, Set<(updates: Uint8Array[]) => void>>();
const connectionListeners = new Set<(connected: boolean) => void>();
const conflictListeners = new Set<(docId: string) => void>();
/** 当前客户端应在线的文档房间（切换文档时 leave，重连时只 rejoin 集合内） */
const docRooms = new Set<string>();

const localDB = createWebLocalDB();

const notifyConnectionChange = (connected: boolean) => {
  connectionListeners.forEach((listener) => listener(connected));
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const apiClient = {
  /**
   * 分页拉取远端更新；失败时抛错，避免引擎误判为“无增量”。
   */
  async pull(docId: string, cursor?: number, limit?: number, snapshotVersion?: number) {
    const allUpdates: Uint8Array[] = [];
    let currentCursor = cursor || 0;
    let hasMoreData = true;
    let snapshotResult: Uint8Array | undefined = undefined;
    let retryCount = 0;
    const maxRetries = 3;
    const maxExecutionTime = 120000;
    let iterationCount = 0;
    let latestUpdateId = cursor || 0;
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
          limit: limit || 100,
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

        if (iterationCount === 1 && response.snapshot) {
          snapshotResult = base64ToUint8Array(response.snapshot);
        }

        const updates = response.updates.map((update: string) =>
          base64ToUint8Array(update),
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

    if (Date.now() - startTime >= maxExecutionTime) {
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

  async push(docId: string, updates: Uint8Array[], baseUpdateId?: number) {
    if (updates.length === 0) return { latestUpdateId: baseUpdateId };
    const base64Updates = updates.map((update) => uint8ArrayToBase64(update));
    const response = await documentApi.syncPush({
      docId,
      updates: base64Updates,
      clientId: CLIENT_ID,
      baseUpdateId,
    });
    return { latestUpdateId: response.latestUpdateId };
  },
};

const syncEngine = createSyncEngine({
  localDB,
  api: apiClient,
  clientId: CLIENT_ID,
});

export const initSocket = (): Socket => {
  if (socket) return socket;

  socket = io(SYNC_SOCKET_URL, {
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: SOCKET_CONNECT_TIMEOUT_MS,
  });

  socket.on('connect', () => {
    notifyConnectionChange(true);
    // 重连后只 rejoin 当前集合（join-doc 服务端会踢掉其它 doc 房间）
    docRooms.forEach((docId) => {
      socket?.emit('join-doc', { docId });
    });
  });

  socket.on('disconnect', () => {
    notifyConnectionChange(false);
  });

  socket.on('update', ({ docId, data }) => {
    // REST 广播会进本机房间：忽略本 clientId，避免把刚 push 的 updates 回灌
    if (data?.clientId && data.clientId === CLIENT_ID) {
      return;
    }
    const listeners = updateListeners.get(docId);
    if (listeners && data.updates) {
      const decodedUpdates = base64ArrayToUint8ArrayArray(data.updates);
      listeners.forEach((listener) => listener(decodedUpdates));
    }
  });

  // 仅通知页面；由页面触发一次 syncDocument，避免双重全量同步
  socket.on('conflict', ({ docId }: { docId: string }) => {
    if (!docId) return;
    conflictListeners.forEach((cb) => cb(docId));
  });

  return socket;
};

/** 注册同步冲突回调（如编辑页刷新） */
export const onSyncConflict = (callback: (docId: string) => void): (() => void) => {
  conflictListeners.add(callback);
  return () => conflictListeners.delete(callback);
};

export const connectSocket = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const connectWithToken = async () => {
      const tokens = await authService.getTokens();
      const s = initSocket();
      s.auth = { token: tokens?.access_token ?? '' };

      if (s.connected) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        s.off('connect', onConnect);
        s.off('connect_error', onError);
        reject(new Error('WebSocket 连接超时'));
      }, SOCKET_CONNECT_TIMEOUT_MS);

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

export const isWebSocketConnected = (): boolean => {
  return socket?.connected ?? false;
};

/** 订阅 Socket.io 连接状态，供 UI 在连接生命周期变化时刷新展示。 */
export const onConnectionChange = (callback: (connected: boolean) => void): (() => void) => {
  connectionListeners.add(callback);
  callback(isWebSocketConnected());
  return () => connectionListeners.delete(callback);
};

export const getYDoc = (docId: string): Y.Doc => {
  return syncEngine.getYDoc(docId);
};

export const syncDocument = async (docId: string): Promise<void> => {
  await syncEngine.syncDoc(docId);
};

/**
 * 加入文档实时房间。
 * 输入：docId；输出：无（失败时降级为仅 REST）
 */
export const joinDocRoom = async (docId: string): Promise<void> => {
  if (docRooms.has(docId)) return;

  try {
    await connectSocket();
    socket?.emit('join-doc', { docId });
    docRooms.add(docId);
  } catch (error) {
    console.warn('WebSocket 未连接，将仅使用 REST 同步:', error);
  }
};

/**
 * 离开文档实时房间（切文档 / 卸载时调用）。
 * 输入：docId；输出：无
 */
export const leaveDocRoom = async (docId: string): Promise<void> => {
  if (!docRooms.has(docId)) return;
  docRooms.delete(docId);
  try {
    if (socket?.connected) {
      socket.emit('leave-doc', { docId });
    }
  } catch (error) {
    console.warn('leave-doc 失败:', error);
  }
};

export const onUpdate = (docId: string, callback: (updates: Uint8Array[]) => void): void => {
  if (!updateListeners.has(docId)) {
    updateListeners.set(docId, new Set());
  }
  updateListeners.get(docId)?.add(callback);
};

export const offUpdate = (docId: string, callback: (updates: Uint8Array[]) => void): void => {
  updateListeners.get(docId)?.delete(callback);
};

export { syncEngine, localDB, SYNC_REPLAY_ORIGIN };
