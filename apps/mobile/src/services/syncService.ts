/**
 * React Native 同步服务
 * 复用@inkweaver/sync-engine实现完整的同步功能
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { documentApi } from '@inkweaver/api';
import type { Document } from '@inkweaver/shared';
import { 
  base64ToUint8Array, 
  uint8ArrayToBase64,
  base64ArrayToUint8ArrayArray 
} from '@inkweaver/shared';
import { createSyncEngine } from '@inkweaver/sync-engine';

export const CLIENT_ID = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const rnLocalDB = {
  async getDoc(docId: string): Promise<Document | null> {
    const key = `syncbox_doc_${docId}`;
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  },

  async saveDoc(doc: Document): Promise<void> {
    const key = `syncbox_doc_${doc.id}`;
    await AsyncStorage.setItem(key, JSON.stringify(doc));
  },

  async deleteDoc(docId: string): Promise<void> {
    const key = `syncbox_doc_${docId}`;
    await AsyncStorage.removeItem(key);
  },

  async getAllDocuments(): Promise<Document[]> {
    const keys = await AsyncStorage.getAllKeys();
    const docKeys = keys.filter(key => key.startsWith('syncbox_doc_'));
    const items: Document[] = [];
    for (const key of docKeys) {
      const value = await AsyncStorage.getItem(key);
      if (value) {
        items.push(JSON.parse(value));
      }
    }
    return items;
  },

  async saveUpdate(update: { docId: string; update: Uint8Array; clientId: string; timestamp: number; pending?: boolean }): Promise<void> {
    const key = `syncbox_update_${update.docId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const updateData = {
      ...update,
      update: uint8ArrayToBase64(update.update),
    };
    await AsyncStorage.setItem(key, JSON.stringify(updateData));
  },

  async getPendingUpdates(docId: string): Promise<{ update: Uint8Array; clientId: string; timestamp: number }[]> {
    const keys = await AsyncStorage.getAllKeys();
    const updateKeys = keys.filter(key => key.startsWith(`syncbox_update_${docId}_`));
    const items: { update: Uint8Array; clientId: string; timestamp: number }[] = [];
    for (const key of updateKeys) {
      const value = await AsyncStorage.getItem(key);
      if (value) {
        const parsed = JSON.parse(value);
        items.push({
          ...parsed,
          update: base64ToUint8Array(parsed.update),
        });
      }
    }
    return items;
  },

  async clearPending(docId: string): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const updateKeys = keys.filter(key => key.startsWith(`syncbox_update_${docId}_`));
    for (const key of updateKeys) {
      await AsyncStorage.removeItem(key);
    }
  },

  async saveSnapshot(docId: string, snapshot: Uint8Array): Promise<void> {
    const key = `syncbox_snapshot_${docId}`;
    await AsyncStorage.setItem(key, uint8ArrayToBase64(snapshot));
  },

  async getSnapshot(docId: string): Promise<Uint8Array | null> {
    const key = `syncbox_snapshot_${docId}`;
    const data = await AsyncStorage.getItem(key);
    return data ? base64ToUint8Array(data) : null;
  },
};

const apiClient = {
  async pull(docId: string, cursor?: number, limit?: number) {
    try {
      const allUpdates: Uint8Array[] = [];
      let currentCursor = cursor || 0;
      let hasMoreData = true;
      let snapshotResult: Uint8Array | undefined = undefined;
      let retryCount = 0;
      const maxRetries = 3;
      const maxExecutionTime = 120000;
      const startTime = Date.now();

      while (hasMoreData && retryCount < maxRetries && (Date.now() - startTime) < maxExecutionTime) {
        try {
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
          
          if (currentCursor === 0 && response.snapshot) {
            console.log('Received snapshot from server');
            snapshotResult = base64ToUint8Array(response.snapshot);
          }
          
          if (response.updates.length === 0) {
            hasMoreData = false;
            break;
          }
          
          const updates = response.updates.map((update: string) => base64ToUint8Array(update));
          allUpdates.push(...updates);
          hasMoreData = response.hasMore || false;
          currentCursor = response.nextCursor || currentCursor;

          if (!hasMoreData || currentCursor === (cursor || 0)) {
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

      console.log(`Pull completed: ${allUpdates.length} updates received, final cursor: ${currentCursor}`);
      
      return { 
        updates: allUpdates,
        nextCursor: currentCursor,
        hasMore: false,
        latestUpdateId: currentCursor,
        snapshot: snapshotResult
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
  
  async push(docId: string, updates: Uint8Array[]) {
    if (updates.length === 0) return;
    try {
      const base64Updates = updates.map(update => uint8ArrayToBase64(update));
      await documentApi.syncPush({ docId, updates: base64Updates, clientId: CLIENT_ID });
      console.log(`Successfully pushed ${updates.length} updates to server`);
    } catch (error) {
      console.error('Push failed:', error);
      throw error;
    }
  }
};

const syncEngine = createSyncEngine({
  localDB: rnLocalDB as any,
  api: apiClient as any,
  clientId: CLIENT_ID,
});

export async function syncDocument(docId: string) {
  try {
    const result = await syncEngine.syncDoc(docId);
    console.log('Sync completed:', result);
    return result;
  } catch (error) {
    console.error('Sync document failed:', error);
    throw error;
  }
}

export function getYDoc(docId: string) {
  return syncEngine.getYDoc(docId);
}

export const syncService = {
  async getDocument(docId: string): Promise<Document> {
    return documentApi.getDocument(docId);
  },

  async createDocument(data: { title: string; content: string }): Promise<Document> {
    return documentApi.createDocument(data);
  },

  async updateDocument(docId: string, data: { title?: string; content?: string }): Promise<Document> {
    return documentApi.updateDocument(docId, data);
  },

  async deleteDocument(docId: string): Promise<void> {
    return documentApi.deleteDocument(docId);
  },

  async getDocuments(): Promise<Document[]> {
    const result = await documentApi.getDocuments();
    return result.documents;
  },

  syncDocument,
  getYDoc,
  
  async saveDocument(doc: Document): Promise<void> {
    await rnLocalDB.saveDoc(doc);
  },

  async getAllDocuments(): Promise<Document[]> {
    return await rnLocalDB.getAllDocuments();
  },

  async clearCache(docId: string): Promise<void> {
    await rnLocalDB.clearPending(docId);
    syncEngine.clearYDocCache(docId);
  },

  async initialize(): Promise<void> {
    console.log('Mobile同步服务初始化完成');
  },

  async cleanup(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const syncKeys = keys.filter(key => key.startsWith('syncbox_'));
    for (const key of syncKeys) {
      await AsyncStorage.removeItem(key);
    }
    console.log('清理所有同步数据完成');
  },

  get engine() {
    return syncEngine;
  },
  
  options: {
    localDB: rnLocalDB,
  },
};
