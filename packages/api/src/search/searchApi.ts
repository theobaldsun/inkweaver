import { apiClient } from '../client';

export interface SearchHistoryItem {
  keyword: string;
  count: number;
  updatedAt: string;
}

export const searchApi = {
  async getSearchHistory(limit: number = 10): Promise<{ history: SearchHistoryItem[] }> {
    return apiClient.get('/search/history', {
      params: { limit },
    });
  },

  async addSearchHistory(keyword: string): Promise<{ message: string }> {
    return apiClient.post('/search/history', undefined, {
      params: { keyword },
    });
  },

  async deleteSearchHistory(keyword: string): Promise<{ message: string }> {
    return apiClient.delete('/search/history', {
      params: { keyword },
    });
  },

  async clearSearchHistory(): Promise<{ message: string }> {
    return apiClient.delete('/search/history/all');
  },
};