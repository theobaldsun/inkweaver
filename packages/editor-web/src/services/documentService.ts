import { documentApi } from '@inkweaver/api';
import type { Document, CreateDocumentRequest, UpdateDocumentRequest } from '@inkweaver/shared';

export const documentService = {
  async createDocument(data: CreateDocumentRequest): Promise<Document> {
    return documentApi.createDocument(data);
  },

  async getDocuments(page: number = 1, pageSize: number = 10) {
    return documentApi.getDocuments(page, pageSize);
  },

  async getDocument(docId: string): Promise<Document> {
    return documentApi.getDocument(docId);
  },

  async updateDocument(docId: string, data: UpdateDocumentRequest): Promise<Document> {
    return documentApi.updateDocument(docId, data);
  },

  async deleteDocument(docId: string): Promise<void> {
    return documentApi.deleteDocument(docId);
  },

  async searchDocuments(keyword: string, page: number = 1, pageSize: number = 10) {
    return documentApi.searchDocuments(keyword, page, pageSize);
  },
};