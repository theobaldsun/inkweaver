/**
 * 全文搜索页：支持 URL 查询参数 `?q=` 深链。
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

const highlightSearchTerm = (text: string, term: string): React.ReactNode => {
  if (!term) return text;
  const regex = new RegExp(`(${term})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) =>
    regex.test(part) ? (
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

    setSearching(true);
    setSearchError('');
    try {
      const response = await documentService.searchDocuments(searchQuery, 1, 20);
      setResults(response.documents);

      await searchApi.addSearchHistory(searchQuery).catch(() => undefined);

      setHistory((prev) => {
        if (prev.some((item) => item.keyword === searchQuery)) return prev;
        return [{
          keyword: searchQuery,
          count: 1,
          updatedAt: new Date().toISOString(),
        }, ...prev].slice(0, 10);
      });
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
      setSearchError(error instanceof Error ? error.message : '搜索失败，请稍后重试');
    } finally {
      setSearching(false);
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
