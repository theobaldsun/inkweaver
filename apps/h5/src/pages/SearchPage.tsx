import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { documentApi, searchApi } from '@inkweaver/api';
import { Search, X, FileText, Clock, Trash2, User } from 'lucide-react';
import type { Document } from '@inkweaver/shared';

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    loadSearchHistory();
  }, []);

  useEffect(() => {
    const q = searchParams.get('q')?.trim();
    if (q) {
      setSearchQuery(q);
      void runSearch(q);
    }
  }, [searchParams]);

  const runSearch = async (keyword: string) => {
    setLoading(true);
    try {
      await searchApi.addSearchHistory(keyword);
      await loadSearchHistory();
      const result = await documentApi.searchDocuments(keyword);
      setSearchResults(result.documents);
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSearchHistory = async () => {
    try {
      const result = await searchApi.getSearchHistory(10);
      setSearchHistory(result.history.map(item => item.keyword));
    } catch (error) {
      console.error('加载搜索历史失败:', error);
      setSearchHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      await searchApi.addSearchHistory(searchQuery);
      await loadSearchHistory();
      
      const result = await documentApi.searchDocuments(searchQuery);
      setSearchResults(result.documents);
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      await searchApi.clearSearchHistory();
      setSearchHistory([]);
    } catch (error) {
      console.error('清空搜索历史失败:', error);
    }
  };

  const handleRemoveHistoryItem = async (item: string) => {
    try {
      await searchApi.deleteSearchHistory(item);
      setSearchHistory(prev => prev.filter(i => i !== item));
    } catch (error) {
      console.error('删除搜索历史失败:', error);
    }
  };

  const handleSelectHistoryItem = async (item: string) => {
    setSearchQuery(item);
    setLoading(true);
    try {
      await searchApi.addSearchHistory(item);
      await loadSearchHistory();
      
      const result = await documentApi.searchDocuments(item);
      setSearchResults(result.documents);
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
  };

  const highlightKeyword = (text: string, keyword: string) => {
    if (!keyword) return text;
    const regex = new RegExp(`(${keyword})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, index) => 
      regex.test(part) ? (
        <span key={index} className="highlight">{part}</span>
      ) : (
        part
      )
    );
  };

  return (
    <div className="main-content search-container">
      <form onSubmit={handleSearch} className="search-input-container">
        <Search className="search-icon" size={18} />
        <input
          type="text"
          className="search-input"
          placeholder="搜索笔记..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button 
            type="button"
            className="search-clear" 
            onClick={(e) => {
              e.preventDefault();
              clearSearch();
            }}
          >
            <X size={16} />
          </button>
        )}
      </form>

      {!searchQuery && (
        <div className="search-history">
          <div className="search-history-title">
            <span>搜索历史</span>
            {searchHistory.length > 0 && (
              <button className="clear-history" onClick={handleClearHistory}>
                清空
              </button>
            )}
          </div>
          
          {historyLoading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
            </div>
          ) : searchHistory.length > 0 ? (
            <div className="history-list">
              {searchHistory.map((item, index) => (
                <div 
                  key={index} 
                  className="history-item"
                  onClick={() => handleSelectHistoryItem(item)}
                >
                  <Clock className="history-item-icon" size={16} />
                  <span className="history-item-text">{item}</span>
                  <button 
                    className="history-item-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveHistoryItem(item);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-history">
              <Search size={48} className="empty-history-icon" />
              <p>暂无搜索历史</p>
              <p className="empty-history-sub">输入关键词开始搜索</p>
            </div>
          )}
        </div>
      )}

      {searchQuery && (
        <div className="search-results">
          <div className="search-results-title">
            搜索结果
          </div>
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <span className="loading-text">搜索中...</span>
            </div>
          ) : searchResults.length > 0 ? (
            <div className="results-list">
              {searchResults.map((doc) => (
                <Link 
                  key={doc.id} 
                  to={`/documents/${doc.id}`}
                  className="result-item"
                >
                  <div className="result-header">
                    <FileText size={18} />
                    <div className="result-title">
                      {highlightKeyword(doc.title || '无标题文档', searchQuery)}
                    </div>
                  </div>
                  <div className="result-content">
                    {highlightKeyword(doc.content ? doc.content.substring(0, 150) + (doc.content.length > 150 ? '...' : '') : '空文档', searchQuery)}
                  </div>
                  <div className="result-meta">
                    <span className="result-date">{new Date(doc.updatedAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-results">
              <Search size={56} className="empty-icon" />
              <p>未找到相关笔记</p>
              <p className="empty-results-sub">尝试其他关键词</p>
            </div>
          )}
        </div>
      )}

      <div className="bottom-nav">
        <Link to="/notes" className="nav-item">
          <FileText className="nav-icon" size={22} />
          <div className="nav-label">笔记</div>
        </Link>
        <Link to="/search" className="nav-item active">
          <Search className="nav-icon" size={22} />
          <div className="nav-label">搜索</div>
        </Link>
        <Link to="/profile" className="nav-item">
          <User className="nav-icon" size={22} />
          <div className="nav-label">我的</div>
        </Link>
      </div>
    </div>
  );
};
