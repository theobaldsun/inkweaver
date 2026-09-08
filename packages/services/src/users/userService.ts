import {

  userApi,

  type UpdateUserRequest,

  type ChangePasswordRequest,

} from '@inkweaver/api';
import { formatStorageSize } from '@inkweaver/shared';

import { storageService } from '../storage/storageService';

import type { User, UserSettings, UserStorageUsage } from '@inkweaver/shared';



export const userService = {

  async getProfile(): Promise<User> {

    return userApi.getProfile();

  },



  async updateProfile(data: UpdateUserRequest): Promise<User> {

    return userApi.updateProfile(data);

  },



  async changePassword(data: ChangePasswordRequest): Promise<{ message: string }> {

    return userApi.changePassword(data);

  },



  async getPreferences(): Promise<UserSettings> {

    return userApi.getPreferences();

  },



  async updatePreferences(data: Partial<UserSettings>): Promise<UserSettings> {

    return userApi.updatePreferences(data);

  },



  async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {

    return userApi.uploadAvatar(file);

  },



  async exportData(password: string): Promise<Blob> {

    return userApi.exportData(password);

  },



  async deleteAllData(password: string): Promise<{ message: string }> {

    return userApi.deleteAllData(password);

  },



  async deleteAccount(password: string): Promise<{ message: string }> {

    return userApi.deleteAccount(password);

  },



  async getSessions(currentSessionId?: string) {

    return userApi.getSessions(currentSessionId);

  },



  async revokeSession(sessionId: string) {

    return userApi.revokeSession(sessionId);

  },



  async revokeAllSessions(exceptSessionId?: string) {

    return userApi.revokeAllSessions(exceptSessionId);

  },



  async getStorageStats() {

    return userApi.getStorageStats();

  },



  async getStorageUsage(options?: { recalculate?: boolean }): Promise<UserStorageUsage> {

    return storageService.getUsage(options);

  },



  formatStorageSize,

};

