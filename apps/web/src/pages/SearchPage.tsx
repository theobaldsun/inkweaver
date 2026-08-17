/**
 * 全文搜索页：支持 URL 查询参数 `?q=` 深链。
 *
 * 已修复缺陷：
 * - WEB-P2-05: highlightSearchTerm 正则注入 + lastIndex 缺陷
 * - WEB-P2-06: 搜索请求竞态，结果错序
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X, History, FileText } from 'lucide-react';
import { documentService, searchApi } from '../services/apiClient';
import type { Document } from '@inkweaver/shared';

const SEARCH_HISTORY_KEY = 'search_history';

interface SearchHistoryItem {
  keyword: string;
  count: number;
  updatedAt: string;
}

const stripHtmlTags = (html: string): string => {
  if (!html) return '';
  const stripped = html.replace(/<[^>]*>/g, '');
  const cleaned = stripped.replace(/\s+/g, ' ').trim();
  return cleaned.length > 100 ? cleaned.substring(0, 100) + '...' : cleaned;
};

/** 转义正则特殊字符，防止用户输入被当作正则指令执行 */
const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 高亮搜索关键词。
 *
 * 修复点（WEB-P2-05）：
 * 1. 使用 escapeRegExp 转义 term，防止用户输入的正则特殊字符导致构造非法正则
 *    例：用户搜索 "a+b" 时，转义后变成 "a\+b"，匹配字面量 "a+b" 而非 "a" 后面一个或多个 "b"
 * 2. 不使用带 g 标志的正则做 test（会受 lastIndex 影响产生状态化行为）
 *    改用 String.prototype.includes 做无状态判断，彻底避免 lastIndex 问题
 */
const highlightSearchTerm = (text: string, term: string): React.ReactNode => {
  if (!term) return text;
  const escaped = escapeRegExp(term);
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) =>
    part.toLowerCase().includes(term.toLowerCase()) ? (
      <span key={index} className="highlight">{part}</span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
};

export const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Document[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  /** 请求序号：确保只有最新搜索请求的结果被应用，防止竞态 */
  const searchRequestIdRef = React.useRef(0);

  useEffect(() => {
    loadSearchHistory();
  }, []);

  useEffect(() => {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const loadSearchHistory = async () => {
    try {
      setLoadingHistory(true);
      const response = await searchApi.getSearchHistory(10);
      if (response.history && Array.isArray(response.history)) {
        setHistory(response.history.map(item => ({
          keyword: typeof item === 'string' ? item : item.keyword,
          count: typeof item === 'string' ? 0 : (item.count || 0),
          updatedAt: typeof item === 'string' ? new Date().toISOString() : (item.updatedAt || new Date().toISOString()),
        })));
      }
    } catch (error) {
      console.error('Failed to load search history:', error);
      const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (saved) {
        const savedHistory = JSON.parse(saved);
        setHistory(savedHistory.map((item: string | SearchHistoryItem) => ({
          keyword: typeof item === 'string' ? item : item.keyword,
          count: typeof item === 'string' ? 0 : (item.count || 0),
          updatedAt: typeof item === 'string' ? new Date().toISOString() : (item.updatedAt || new Date().toISOString()),
        })));
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    // 修复 WEB-P2-06：请求序号机制。每次搜索递增序号，仅允许最新请求更新状态
    // 场景：用户输入 "hel"→"hello"，两个请求并发，旧请求可能后发先至
    // 通过序号检查，确保只有最新请求（序号最大）的结果被采纳
    const requestId = ++searchRequestIdRef.current;
    setSearching(true);
    setSearchError('');
    try {
      const response = await documentService.searchDocuments(searchQuery, 1, 20);
      // 仅当此请求仍是最新请求时才更新结果（防止快速连续搜索导致错序）
      if (requestId === searchRequestIdRef.current) {
        setResults(response.documents);
      }

      await searchApi.addSearchHistory(searchQuery).catch(() => undefined);

      if (requestId === searchRequestIdRef.current) {
        setHistory((prev) => {
          if (prev.some((item) => item.keyword === searchQuery)) return prev;
          return [{
            keyword: searchQuery,
            count: 1,
            updatedAt: new Date().toISOString(),
          }, ...prev].slice(0, 10);
        });
      }
    } catch (error) {
      console.error('Search failed:', error);
      if (requestId === searchRequestIdRef.current) {
        setResults([]);
        setSearchError(error instanceof Error ? error.message : '搜索失败，请稍后重试');
      }
    } finally {
      // 只有最新请求才能关闭 loading 状态，防止旧请求的 finally 把新请求的 loading 提前关掉
      if (requestId === searchRequestIdRef.current) {
        setSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    const q = searchParams.get('q')?.trim();
    if (q) {
      setQuery(q);
      void handleSearch(q);
    }
  }, [searchParams, handleSearch]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (value.trim()) {
      setSearchParams({ q: value.trim() });
    } else {
      setSearchParams({});
      setResults([]);
      setSearchError('');
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setSearchError('');
    setSearchParams({});
  };

  const handleHistoryClick = (keyword: string) => {
    setQuery(keyword);
    setSearchParams({ q: keyword });
  };

  const handleRemoveHistory = async (keyword: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.keyword !== keyword));
    await searchApi.deleteSearchHistory(keyword);
  };

  const handleClearHistory = async () => {
    setHistory([]);
    await searchApi.clearSearchHistory();
  };

  const handleResultClick = (id: string) => {
    navigate(`/documents/${id}`);
  };

  return (
    <div className="search-container">
      <div className="search-input-container">
        <SearchIcon className="search-icon" size={20} />
        <input
          type="text"
          className="search-input"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="搜索笔记..."
          autoFocus
        />
        {query && (
          <button className="search-clear" onClick={handleClear}>
            <X size={18} />
          </button>
        )}
      </div>

      {searching && (
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      )}

      {searchError && !searching && (
        <div className="empty-history">
          <p>{searchError}</p>
        </div>
      )}

      {!searching && results.length > 0 ? (
        <div className="search-results">
          <div className="search-results-title">
            找到 {results.length} 个结果
          </div>
          <div className="results-list">
            {results.map((result) => (
              <div
                key={result.id}
                className="result-item"
                onClick={() => handleResultClick(result.id)}
              >
                <div className="result-title">
                  {highlightSearchTerm(result.title || '无标题', query)}
                </div>
                <div className="result-content">
                  {highlightSearchTerm(stripHtmlTags(result.content), query)}
                </div>
                <div className="result-meta">
                  <span className="result-date">
                    {new Date(result.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : !searching && !searchError && query.trim() ? (
        <div className="empty-history">
          <FileText size={40} />
          <p>未找到匹配的文档</p>
        </div>
      ) : !searching && !query.trim() ? (
        <div className="history-list">
          <div className="search-history-title">
            <span>搜索历史</span>
            <button className="clear-history" onClick={handleClearHistory}>
              清空
            </button>
          </div>

          {loadingHistory ? (
            <div className="loading-container">
              <div className="loading-spinner" />
            </div>
          ) : history.length > 0 ? (
            history.map((item) => (
              <div
                key={item.keyword}
                className="history-item"
                onClick={() => handleHistoryClick(item.keyword)}
              >
                <History className="history-item-icon" size={18} />
                <span className="history-item-text">{item.keyword}</span>
                {item.count > 0 && (
                  <span className="history-item-count">{item.count}</span>
                )}
                <button
                  className="history-item-remove"
                  onClick={(e) => handleRemoveHistory(item.keyword, e)}
                >
                  <X size={16} />
                </button>
              </div>
            ))
          ) : (
            <div className="empty-history">
              <div className="empty-history-icon">
                <SearchIcon size={48} />
              </div>
              <p>还没有搜索记录</p>
              <p className="empty-history-sub">输入关键词开始搜索你的笔记</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
