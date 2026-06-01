/**
 * 通知 API 客户端。
 */

import { apiClient } from '../client';

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export const notificationApi = {
  async list(): Promise<{ items: NotificationItem[]; unreadCount: number }> {
    return apiClient.get('/notifications');
  },

  async markRead(id: string): Promise<{ success: boolean }> {
    return apiClient.patch(`/notifications/${id}/read`);
  },

  async markAllRead(): Promise<{ success: boolean }> {
    return apiClient.post('/notifications/read-all');
  },
};
