/**
 * 文档相关的 API 接口
 */

import { apiClient } from '../client';
import type { Document, CreateDocumentRequest, UpdateDocumentRequest } from '@inkweaver/shared';

/**
 * 同步拉取请求
 */
interface SyncPullRequest {
  docId: string;
  cursor?: number; // 游标，表示客户端最后收到的 update_id
  limit?: number; // 每次拉取的最大更新数量，默认 100
  snapshotVersion?: number; // 客户端快照版本，用于判断是否需要返回快照
}

/**
 * 同步推送请求
 */
interface SyncPushRequest {
  docId: string;
  updates: string[];
  clientId?: string;
  baseUpdateId?: number;
}

/**
 * 同步拉取响应
 */
interface SyncPullResponse {
  updates: string[];
  nextCursor: number;
  hasMore: boolean;
  snapshot?: string;
  latestUpdateId?: number;
}

/**
 * 同步推送响应
 */
interface SyncPushResponse {
  success: boolean;
  latestUpdateId?: number;
  updateIds?: number[];
}

/**
 * 文档 API 接口
 */
export const documentApi = {
  /**
   * 创建文档
   * @param data 创建文档数据
   * @returns 创建的文档
   */
  async createDocument(data: CreateDocumentRequest): Promise<Document> {
    return apiClient.post('/documents', data);
  },

  /**
   * 获取文档列表
   * @param page 页码
   * @param pageSize 每页大小
   * @param sortBy 排序字段
   * @param sortOrder 排序顺序
   * @returns 文档列表
   */
  async getDocuments(
    page: number = 1,
    pageSize: number = 10,
    sortBy: string = 'updatedAt',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    options?: {
      folderId?: string | null;
      filter?: 'all' | 'recent' | 'mine' | 'public';
    },
  ): Promise<{
    documents: Document[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const params: Record<string, string | number> = { page, pageSize, sortBy, sortOrder };
    if (options?.folderId !== undefined) {
      params.folderId = options.folderId === null ? 'root' : options.folderId;
    }
    if (options?.filter && options.filter !== 'all') {
      params.filter = options.filter;
    }
    return apiClient.get('/documents', { params });
  },

  /**
   * 获取文档详情
   * @param docId 文档 ID
   * @returns 文档详情
   */
  async getDocument(docId: string): Promise<Document> {
    return apiClient.get(`/documents/${docId}`);
  },

  /**
   * 更新文档
   * @param docId 文档 ID
   * @param data 更新文档数据
   * @returns 更新后的文档
   */
  async updateDocument(docId: string, data: UpdateDocumentRequest): Promise<Document> {
    return apiClient.put(`/documents/${docId}`, data);
  },

  /**
   * 删除文档
   * @param docId 文档 ID
   * @returns 删除结果
   */
  async deleteDocument(docId: string): Promise<void> {
    return apiClient.delete(`/documents/${docId}`);
  },

  /**
   * 获取回收站文档列表
   */
  async getTrashDocuments(
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{
    documents: Document[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return apiClient.get('/documents/trash', {
      params: { page, pageSize },
    });
  },

  /**
   * 从回收站恢复文档
   */
  async restoreDocument(docId: string): Promise<Document> {
    return apiClient.post(`/documents/${docId}/restore`);
  },

  /**
   * 永久删除回收站中的文档
   */
  async permanentDeleteDocument(docId: string): Promise<void> {
    return apiClient.delete(`/documents/${docId}/permanent`);
  },

  /**
   * 清空回收站
   */
  async emptyTrash(): Promise<{ deletedCount: number }> {
    return apiClient.delete('/documents/trash');
  },

  /**
   * 移动文档到指定文件夹
   * @param docId 文档 ID
   * @param folderId 目标文件夹 ID，null 表示移动到根目录
   * @returns 更新后的文档
   */
  async moveDocument(docId: string, folderId: string | null): Promise<Document> {
    return apiClient.put(`/documents/${docId}`, { folderId });
  },

  /**
   * 搜索文档
   * @param keyword 搜索关键词
   * @param page 页码
   * @param pageSize 每页大小
   * @returns 搜索结果
   */
  async searchDocuments(keyword: string, page: number = 1, pageSize: number = 10): Promise<{
    documents: Document[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return apiClient.get('/documents/search', {
      params: { keyword, page, pageSize },
    });
  },

  /**
   * 同步拉取
   * @param data 拉取请求数据
   * @returns 拉取的更新
   */
  async syncPull(data: SyncPullRequest): Promise<SyncPullResponse> {
    return apiClient.post('/sync/pull', data);
  },

  /**
   * 同步推送
   * @param data 推送请求数据
   * @returns 推送结果
   */
  async syncPush(data: SyncPushRequest): Promise<SyncPushResponse> {
    return apiClient.post('/sync/push', data);
  },

  /**
   * 生成或刷新公开分享链接
   */
  async generateShareLink(docId: string): Promise<{ shareLink: string; shareUrl: string }> {
    return apiClient.post(`/documents/${docId}/share-link`);
  },

  /**
   * 通过分享 token 只读获取文档（无需登录）
   */
  async getSharedDocument(token: string): Promise<{ title: string; content: string; isPublic: boolean }> {
    return apiClient.get(`/documents/shared/${token}`);
  },
};
