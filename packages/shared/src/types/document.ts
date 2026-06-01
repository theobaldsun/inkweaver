/**
 * 文档相关类型定义
 */

/** 回收站保留天数 */
export const TRASH_RETENTION_DAYS = 30;

// 文件夹结构
export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  userId: string;
  children?: Folder[];
  createdAt: string;
  updatedAt: string;
}

// 创建文件夹请求
export interface CreateFolderRequest {
  name: string;
  parentId?: string;
  description?: string;
}

// 更新文件夹请求
export interface UpdateFolderRequest {
  name?: string;
  parentId?: string;
  description?: string;
}

// 文档结构
export interface Document {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  isPublic?: boolean;
  shareLink?: string;
  tags?: string[];
  folderId?: string;
  /** 移入回收站时间 ISO 8601 */
  deletedAt?: string;
  /** 预计永久删除时间 ISO 8601（仅回收站列表） */
  purgeAt?: string;
  yjsSnapshot?: Uint8Array; // Yjs 二进制快照
  lastUpdateId?: number; // 最后同步到的服务端 update_id
}

// 同步更新包
export interface SyncUpdate {
  id?: number; // 自增主键
  docId: string;
  update: Uint8Array;     // Yjs update
  clientId: string;
  timestamp: number;
  pending?: boolean;      // 是否待同步
}

// 创建文档请求
export interface CreateDocumentRequest {
  title: string;
  content: string;
  isPublic?: boolean;
  tags?: string[];
  folderId?: string;
}

// 更新文档请求
export interface UpdateDocumentRequest {
  title?: string;
  content?: string;
  isPublic?: boolean;
  tags?: string[];
  folderId?: string;
}

// 文档响应
export type DocumentResponse = Document;

// 文档列表响应
export interface DocumentListResponse {
  documents: Document[];
  total: number;
  page: number;
  pageSize: number;
}

// 文档操作错误
export interface DocumentError {
  code: string;
  message: string;
}
