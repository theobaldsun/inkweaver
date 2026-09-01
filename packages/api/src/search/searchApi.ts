import { apiClient } from '../client';

/** 搜索模式：智能 / 关键词 / 语义 */
export type SearchMode = 'smart' | 'keyword' | 'semantic';

export interface SearchHistoryItem {
  keyword: string;
  count: number;
  updatedAt: string;
  mode: SearchMode;
}

/** 通道命中标记 */
export type SearchChannel = 'exact' | 'fuzzy' | 'related' | 'semantic';

export interface HybridSearchHit {
  id: string;
  title: string;
  excerpt: string; // 带 <b> 高亮的 HTML（ts_headline 已转义安全）
  score: number; // 匹配度 0~100
  matchedBy: SearchChannel[];
  updatedAt: string;
  tags: string[];
  recentlyOpen: boolean;
}

export interface HybridSearchResult {
  documents: HybridSearchHit[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  truncated: boolean;
}

export const searchApi = {
  async getSearchHistory(limit: number = 10): Promise<{ history: SearchHistoryItem[] }> {
    return apiClient.get('/search/history', {
      params: { limit },
    });
  },

  async addSearchHistory(
    keyword: string,
    mode: SearchMode = 'smart',
  ): Promise<{ message: string }> {
    return apiClient.post('/search/history', undefined, {
      params: { keyword, mode },
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
  /** 混合检索文档（四路融合） */
  async hybridSearch(
    q: string,
    mode: SearchMode = 'smart',
    page: number = 1,
    pageSize: number = 10,
  ): Promise<HybridSearchResult> {
    return apiClient.get('/search/hybrid', { params: { q, mode, page, pageSize } });
  },
};
