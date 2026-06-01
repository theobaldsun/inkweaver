import { userApi, type UpdateUserRequest, type ChangePasswordRequest, type StorageStats } from '@inkweaver/api';
import type { User } from '@inkweaver/shared';

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

  async getStorageStats(): Promise<StorageStats> {
    return userApi.getStorageStats();
  },

  formatStorageSize(bytes: number): string