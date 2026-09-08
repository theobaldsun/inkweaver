/**
 * 文档服务
 * 处理文档相关的业务逻辑
 */

import { documentApi } from '@inkweaver/api';

import { storageService } from '../storage/storageService';

import type { Document, CreateDocumentRequest, UpdateDocumentRequest } from '@inkweaver/shared';

/**
 * 文档服务
 */
export const documentService = {
  /**
   * 创建文档
   * @param data 创建文档数据
   * @returns 创建的文档
   */
  async createDocument(data: CreateDocumentRequest): Promise<Document> {
    const doc = await documentApi.createDocument(data);
    storageService.invalidateCache();
    return doc;
  },

  /**
   * 获取文档列表
   * @param page 页码
   * @param pageSize 每页大小
   * @param sortBy 排序字段
   * @param sortOrder 排序方向
   * @param folderId 文件夹 ID，`null` 表示根目录，省略表示不按文件夹过滤
   * @param filter 列表筛选：all / recent / mine / public
   * @returns 文档列表
   */
  async getDocuments(
    page: number = 1,
    pageSize: number = 10,
    sortBy: string = 'updatedAt',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    folderId?: string | null,
    filter: 'all' | 'recent' | 'mine' | 'public' = 'all',
  ) {
    const apiFilter = filter === 'mine' ? 'all' : filter;
    return documentApi.getDocuments(page, pageSize, sortBy, sortOrder, {
      folderId,
      filter: apiFilter,
    });
  },

  /**
   * 获取文档详情
   * @param docId 文档 ID
   * @returns 文档详情
   */
  async getDocument(docId: string): Promise<Document> {
    return documentApi.getDocument(docId);
  },

  /**
   * 更新文档
   * @param docId 文档 ID
   * @param data 更新文档数据
   * @returns 更新后的文档
   */
  async updateDocument(docId: string, data: UpdateDocumentRequest): Promise<Document> {
    const doc = await documentApi.updateDocument(docId, data);
    storageService.invalidateCache();
    return doc;
  },

  /**
   * 删除文档
   * @param docId 文档 ID
   * @returns 删除结果
   */
  async deleteDocument(docId: string): Promise<void> {
    await documentApi.deleteDocument(docId);
    storageService.invalidateCache();
  },

  async getTrashDocuments(page: number = 1, pageSize: number = 20) {
    return documentApi.getTrashDocuments(page, pageSize);
  },

  async restoreDocument(docId: string): Promise<Document> {
    const doc = await documentApi.restoreDocument(docId);
    storageService.invalidateCache();
    return doc;
  },

  async permanentDeleteDocument(docId: string): Promise<void> {
    await documentApi.permanentDeleteDocument(docId);
    storageService.invalidateCache();
  },

  async emptyTrash(): Promise<{ deletedCount: number }> {
    const result = await documentApi.emptyTrash();
    storageService.invalidateCache();
    return result;
  },

  /**
   * 搜索文档
   * @param keyword 搜索关键词
   * @param page 页码
   * @param pageSize 每页大小
   * @returns 搜索结果
   */
  async searchDocuments(keyword: string, page: number = 1, pageSize: number = 10) {
    return documentApi.searchDocuments(keyword, page, pageSize);
  },
};
