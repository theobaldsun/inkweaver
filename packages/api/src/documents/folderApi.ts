import { apiClient } from '../client';
import type { Folder, CreateFolderRequest, UpdateFolderRequest } from '@inkweaver/shared';

export const folderApi = {
  async createFolder(data: CreateFolderRequest): Promise<Folder> {
    return apiClient.post('/folders', data);
  },

  async getFolders(parentId?: string): Promise<Folder[]> {
    return apiClient.get('/folders', {
      params: parentId ? { parentId } : {},
    });
  },

  async getFolderTree(): Promise<Folder[]> {
    return apiClient.get('/folders/tree');
  },

  async getFolder(folderId: string): Promise<Folder> {
    return apiClient.get(`/folders/${folderId}`);
  },

  async updateFolder(folderId: string, data: UpdateFolderRequest): Promise<Folder> {
    return apiClient.put(`/folders/${folderId}`, data);
  },

  async deleteFolder(folderId: string, deleteAll: boolean = true): Promise<void> {
    return apiClient.delete(`/folders/${folderId}`, {
      params: { deleteAll },
    });
  },
};