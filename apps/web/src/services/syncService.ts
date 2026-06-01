import * as Y from 'yjs';
import { createSyncEngine } from '@inkweaver/sync-engine';
import { createWebLocalDB } from '@inkweaver/db-adapter/web';
import { io, Socket } from 'socket.io-client';
import { documentApi } from '@inkweaver/api';
import { authService } from '@inkweaver/services';
import {
  base64ToUint8Array,
  uint8ArrayToBase64,
  base64ArrayToUint8ArrayArray
} from '@inkweaver/shared';
import { SYNC_SOCKET_URL } from '../config/env';

export const CLIENT_ID = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/** WebSocket 连接超时（毫秒），失败不阻塞文档加载 */
const SOCKET_CONNECT_TIMEOUT_MS = 5000;

let socket: Socket | null = null;
const updateListeners = new Map<string, Set<(updates: Uint8Array[]) => void>>();
const docRooms = new Set<string>();

const localDB = createWebLocalDB();

const apiClient = {
  async pull(docId: string, cursor?: number, limit?: number, snapshotVersion?: number) {
    try {
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

      while (hasMoreData && retryCount < maxRetries && (Date.now() - startTime) < maxExecutionTime) {
        try {
          iterationCount++;
          console.log(`Pull iteration ${iterationCount}, cursor: ${currentCursor}, hasMore: ${hasMoreData}`);
          
          if (Date.now() - startTime > maxExecutionTime) {
            console.warn('Max execution time reached, stopping pull');
            break;
          }
          
          const response = await documentApi.syncPull({ 
            docId, 
            cursor: currentCursor,
            limit: limit || 100,
          });
          
          if (!response || !Array.isArray(response.updates)) {
            console.error('Invalid response from server:', response);
            retryCount++;
            continue;
          }
          
          if (iterationCount === 1 && response.snapshot) {
            console.log('Received snapshot from server');
            snapshotResult = base64ToUint8Array(response.snapshot);
          }
          
          if (response.updates.length === 0) {
            console.log('No updates received, stopping pull');
            hasMoreData = false;
            break;
          }
          
          const updates = response.updates.map((update: string) => base64ToUint8Array(update));
          
          allUpdates.push(...updates);
          hasMoreData = response.hasMore || false;
          currentCursor = response.nextCursor || currentCursor;
          if (typeof (response as { latestUpdateId?: number }).latestUpdateId === 'number') {
            latestUpdateId = (response as { latestUpdateId: number }).latestUpdateId;
          }

          if (!hasMoreData || currentCursor === (cursor || 0)) {
            console.log('Stopping pull: no more data or cursor unchanged');
            break;
          }

          retryCount = 0;
        } catch (error) {
          console.error('Pull request failed:', error);
          retryCount++;
          
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000;
            console.log(`Retrying pull request in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error('Max retries reached, stopping pull');
            break;
          }
        }
      }

      if (Date.now() - startTime >= maxExecutionTime) {
        console.warn('Max execution time reached, stopping pull');
      }

      console.log(`Pull completed: ${allUpdates.length} updates received, final cursor: ${currentCursor}`);
      
      return {
        updates: allUpdates,
        nextCursor: currentCursor,
        hasMore: false,
        latestUpdateId,
        snapshot: snapshotResult,
      };
    } catch (error) {
      console.error('Sync pull failed:', error);
      return { 
        updates: [],
        nextCursor: cursor || 0,
        hasMore: false,
        latestUpdateId: cursor || 0,
        snapshot: undefined
      };
    }
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
    console.log(`Successfully pushed ${updates.length} updates to server`);
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
    console.log('WebSocket connected');
    docRooms.forEach(docId => {
      socket?.emit('join-doc', { docId });
    });
  });
  
  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
  });
  
  socket.on('update', ({ docId, data }) => {
    const listeners = updateListeners.get(docId);
    if (listeners && data.updates) {
      const decodedUpdates = base64ArrayToUint8ArrayArray(data.updates);
      listeners.forEach((listener) => listener(decodedUpdates));
    }
  });

  socket.on('conflict', ({ docId }: { docId: string }) => {
    if (!docId) return;
    syncDocument(docId).catch(console.error);
    conflictListeners.forEach((cb) => cb(docId));
  });

  return socket;
};

const conflictListeners = new Set<(docId: string) => void>();

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

export const getYDoc = (docId: string): Y.Doc => {
  return syncEngine.getYDoc(docId);
};

export const syncDocument = async (docId: string): Promise<void> => {
  await syncEngine.syncDoc(docId);
};

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

export const onUpdate = (docId: string, callback: (updates: Uint8Array[]) => void): void => {
  if (!updateListeners.has(docId)) {
    updateListeners.set(docId, new Set());
  }
  updateListeners.get(docId)?.add(callback);
};

export const offUpdate = (docId: string, callback: (updates: Uint8Array[]) => void): void => {
  updateListeners.get(docId)?.delete(callback);
};

export { syncEngine, localDB };