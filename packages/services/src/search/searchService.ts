/**
 * 搜索历史服务封装。
 */

import { searchApi } from '@inkweaver/api';

export const searchService = {
  async getSearchHistory(limit: number = 100) {
    return searchApi.getSearchHistory(limit);
  },

  async clearSearchHistory() {
    return searchApi.clearSearchHistory();
  },
};
