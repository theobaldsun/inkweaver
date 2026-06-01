import { apiClient, createApiClient } from '../client';

import type { User, UserSettings, UserSessionInfo } from '@inkweaver/shared';
import { hashPasswordForTransport } from '@inkweaver/shared';

import { normalizeUserStorageUsage } from '@inkweaver/shared';



export interface UpdateUserRequest {

  name?: string;

}



export interface ChangePasswordRequest {

  oldPassword: string;

  newPassword: string;

}



export interface DeleteWithPasswordRequest {

  password: string;

}



/** @deprecated 请使用 UserStorageUsage */

export interface StorageStats {

  documentCount: number;

  usedStorage: number;

  totalStorage: number;

}



const rawClient = createApiClient();



export const userApi = {

  async getProfile(): Promise<User> {

    return apiClient.get('/users/profile');

  },



  async updateProfile(data: UpdateUserRequest): Promise<User> {

    return apiClient.put('/users/profile', data);

  },



  async changePassword(data: ChangePasswordRequest): Promise<{ message: string }> {
    const [oldPasswordHash, newPasswordHash] = await Promise.all([
      hashPasswordForTransport(data.oldPassword),
      hashPasswordForTransport(data.newPassword),
    ]);
    return apiClient.post('/users/change-password', { oldPasswordHash, newPasswordHash });
  },



  async getPreferences(): Promise<UserSettings> {

    return apiClient.get('/users/preferences');

  },



  async updatePreferences(data: Partial<UserSettings>): Promise<UserSettings> {

    return apiClient.put('/users/preferences', data);

  },



  async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {

    const formData = new FormData();

    formData.append('file', file);

    return rawClient.post('/users/avatar', formData, {

      headers: { 'Content-Type': 'multipart/form-data' },

    }) as Promise<{ avatarUrl: string }>;

  },



  async exportData(password: string): Promise<Blob> {
    const passwordHash = await hashPasswordForTransport(password);
    return rawClient.post(
      '/users/export',
      { passwordHash },
      { responseType: 'blob' },
    ) as Promise<Blob>;
  },



  async deleteAllData(password: string): Promise<{ message: string }> {
    const passwordHash = await hashPasswordForTransport(password);
    return apiClient.delete('/users/data', { data: { passwordHash } });
  },



  async deleteAccount(password: string): Promise<{ message: string }> {
    const passwordHash = await hashPasswordForTransport(password);
    return apiClient.delete('/users/account', { data: { passwordHash } });
  },



  async getSessions(currentSessionId?: string): Promise<{ sessions: UserSessionInfo[] }> {

    return apiClient.get('/users/sessions', {

      params: currentSessionId ? { currentSessionId } : undefined,

    });

  },



  async revokeSession(sessionId: string): Promise<{ message: string }> {

    return apiClient.delete(`/users/sessions/${sessionId}`);

  },



  async revokeAllSessions(exceptSessionId?: string): Promise<{ message: string }> {

    return apiClient.delete('/users/sessions', {

      params: exceptSessionId ? { exceptSessionId } : undefined,

    });

  },



  async getStorageStats(): Promise<StorageStats> {

    const usage = (await apiClient.get('/users/storage')) as import('@inkweaver/shared').UserStorageUsage;

    const normalized = normalizeUserStorageUsage(usage);

    return {

      documentCount: normalized.documentCount,

      usedStorage: normalized.usedBytes,

      totalStorage: normalized.quotaBytes,

    };

  },

};

