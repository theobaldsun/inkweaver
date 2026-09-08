/**
 * 全文搜索页：支持 URL 查询参数 `?q=` 深链。
 *
 * 设计要点（输入态/查询态分离）：
 * - `query` state：仅跟随输入框，用于受控输入的即时响应，不触发请求
 * - URL（searchParams）：唯一查询真相源，effect 监听并统一发起请求
 * - handlers 只改 URL/state，不直接发请求，避免双轨制重复请求与模式被冲掉
 *
 * 已修复缺陷：
 * - WEB-P2-05: highlightSearchTerm 正则注入 + lastIndex 缺陷
 * - WEB-P2-06: 搜索请求竞态，结果错序
 * - WEB-P2-07: 模式被输入重置 / 模式切换与翻页重复请求 / 清空后旧请求回填 /
 *               最后一页无法返回上一页 / 显示当前页数量而非 total
 */

import { Search as SearchIcon, X, History, FileText } from "lucide-react";
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { searchApi } from "../services/apiClient";
import { sanitizeDocumentHtml } from "../utils/sanitizeDocumentHtml";

import type { HybridSearchHit, SearchMode } from "@inkweaver/api";

const SEARCH_HISTORY_KEY = "search_history";

interface SearchHistoryItem {
  keyword: string;
  count: number;
  updatedAt: string;
  mode: SearchMode;
}

/** 转义正则特殊字符，防止用户输入被当作正则指令执行 */
const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, index) =>
    part.toLowerCase().includes(term.toLowerCase()) ? (
      <span key={index} className="highlight">
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
};

export const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 输入态：仅跟随输入框，用于受控输入体验，不直接触发请求
  const [query, setQuery] = useState("");

  // 查询态：来自 URL 同步，与请求/结果相关
  const [mode, setMode] = useState<SearchMode>("smart");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [truncated, setTruncated] = useState(false);
  // results 类型从 Document[] 改为 HybridSearchHit[]
  const [results, setResults] = useState<HybridSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  /**
   * 请求序号：确保只有最新搜索请求的结果被应用，防止竞态。
   * 清空/提交空查询时主动自增，让在飞请求的回调校验失败，避免旧结果回填空状态。
   */
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
        setHistory(
          response.history.map((item) => ({
            keyword: typeof item === "string" ? item : item.keyword,
            count: typeof item === "string" ? 0 : item.count || 0,
            updatedAt:
              typeof item === "string"
                ? new Date().toISOString()
                : item.updatedAt || new Date().toISOString(),
            mode: typeof item === "string" ? "smart" : item.mode || "smart",
          })),
        );
      }
    } catch (error) {
      console.error("Failed to load search history:", error);
      const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (saved) {
        const savedHistory = JSON.parse(saved);
        setHistory(
          savedHistory.map((item: string | SearchHistoryItem) => ({
            keyword: typeof item === "string" ? item : item.keyword,
            count: typeof item === "string" ? 0 : item.count || 0,
            updatedAt:
              typeof item === "string"
                ? new Date().toISOString()
                : item.updatedAt || new Date().toISOString(),
            mode: typeof item === "string" ? "smart" : item.mode || "smart",
          })),
        );
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  /**
   * 执行搜索（由 effect 统一调用，handlers 不直接调）。
   *
   * 竞态防护：进入时自增 requestId，结果回调时校验仍是最新请求才 setState，
   * 防止快速翻页/连续搜索导致旧结果覆盖新结果。
   *
   * @param searchQuery 搜索关键词（已 trim 校验）
   * @param searchMode 搜索模式
   * @param pageNum 页码（从 1 开始）
   */
  const handleSearch = useCallback(
    async (searchQuery: string, searchMode: SearchMode, pageNum: number = 1) => {
      if (!searchQuery.trim()) return;
      const requestId = ++searchRequestIdRef.current;
      setSearching(true);
      setSearchError("");
      try {
        const response = await searchApi.hybridSearch(searchQuery, searchMode, pageNum, 20);
        // 仅当此请求仍是最新请求时才更新结果（防止快速连续搜索/翻页导致错序）
        if (requestId === searchRequestIdRef.current) {
          setResults(response.documents);
          setTotal(response.total);
          setHasMore(response.hasMore);
          setTruncated(response.truncated);
          setPage(pageNum);
        }
        await searchApi.addSearchHistory(searchQuery, searchMode).catch(() => undefined);
      } catch (error) {
        console.error("Search failed:", error);
        if (requestId === searchRequestIdRef.current) {
          setResults([]);
          setSearchError(error instanceof Error ? error.message : "搜索失败，请稍后重试");
        }
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setSearching(false);
        }
      }
    },
    [],
  );

  /**
   * effect 作为唯一发请求出口：URL 变化 → 同步 state + 触发搜索。
   *
   * URL 无 q 时主动失效在飞请求并清空结果态，防止清空操作后旧请求回填结果。
   * 不清 query state，让输入框保持用户当前输入（用户清空后可能想立刻输入新词）。
   */
  useEffect(() => {
    const q = searchParams.get("q")?.trim();
    const m = (searchParams.get("mode") as SearchMode) || "smart";
    const p = Number(searchParams.get("page")) || 1;
    if (q) {
      // 同步输入态与查询态（深链、history 跳转、回车提交等场景）
      setQuery(q);
      setMode(m);
      void handleSearch(q, m, p);
    } else {
      // URL 无 q：主动失效在飞请求 + 清空结果态（mode/page 复位为默认值）
      searchRequestIdRef.current++;
      setResults([]);
      setSearchError("");
      setTotal(0);
      setHasMore(false);
      setTruncated(false);
      setPage(1);
      setMode("smart");
    }
  }, [searchParams, handleSearch]);

  /**
   * 模式切换：只改 URL（mode + page=1），由 effect 统一发请求。
   * 同模式不触发，避免重复请求。
   */
  const handleModeChange = (m: SearchMode) => {
    const currentMode = (searchParams.get("mode") as SearchMode) || "smart";
    if (m === currentMode) return;
    const next = new URLSearchParams(searchParams);
    next.set("mode", m);
    next.set("page", "1");
    setSearchParams(next);
  };

  /**
   * 翻页：只改 URL（page），由 effect 统一发请求。
   * 同页码不触发，避免重复请求。
   */
  const handlePageChange = (newPage: number) => {
    if (newPage < 1) return;
    const currentPage = Number(searchParams.get("page")) || 1;
    if (newPage === currentPage) return;
    const next = new URLSearchParams(searchParams);
    next.set("page", String(newPage));
    setSearchParams(next);
  };

  /**
   * 输入框变化：仅更新 state，不触发请求。
   * 按回车（handleSearchSubmit）才把 query 同步到 URL，避免每个按键都发请求。
   */
  const handleInputChange = (value: string) => {
    setQuery(value);
  };

  /**
   * 提交搜索（回车触发）：把 query 同步到 URL，由 effect 触发请求。
   * 提交空查询时主动失效在飞请求并清空 URL 与结果态。
   */
  const handleSearchSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) {
      // 提交空：失效在飞请求 + 清空 URL 与结果态
      searchRequestIdRef.current++;
      setResults([]);
      setSearchError("");
      setTotal(0);
      setHasMore(false);
      setTruncated(false);
      setSearchParams({});
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("q", trimmed);
    next.set("page", "1");
    // 保留 URL 上已有 mode（用户切换过的模式不会被冲掉），无则默认 smart
    if (!next.get("mode")) next.set("mode", "smart");
    setSearchParams(next);
  };

  /**
   * 清空按钮：失效在飞请求 + 清空输入与结果 + 清空 URL。
   * 必须主动 ++requestId，否则在飞请求返回时会通过 requestId 校验污染空状态。
   */
  const handleClear = () => {
    searchRequestIdRef.current++;
    setQuery("");
    setResults([]);
    setSearchError("");
    setTotal(0);
    setHasMore(false);
    setTruncated(false);
    setSearchParams({});
  };

  /**
   * 点击历史项：把 keyword + mode 同步到 URL，由 effect 触发请求。
   * 同时更新 query state，让输入框立即显示 keyword，避免 URL 回流前的空窗。
   */
  const handleHistoryClick = (keyword: string, useMode: SearchMode) => {
    setQuery(keyword);
    const next = new URLSearchParams();
    next.set("q", keyword);
    next.set("mode", useMode);
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleRemoveHistory = async (keyword: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory((prev) => prev.filter((item) => item.keyword !== keyword));
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
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearchSubmit();
            }
          }}
          placeholder="搜索笔记..."
          autoFocus
        />
        {query && (
          <button className="search-clear" onClick={handleClear} aria-label="清空搜索">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="search-modes">
        {(["smart", "keyword", "semantic"] as SearchMode[]).map((m) => (
          <button
            key={m}
            className={`search-mode-tab ${mode === m ? "active" : ""}`}
            onClick={() => handleModeChange(m)}
          >
            {m === "smart" ? "智能" : m === "keyword" ? "关键词" : "语义"}
          </button>
        ))}
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
          {/* 总匹配数（来自后端 total），非当前页数量 */}
          <div className="search-results-title">找到 {total} 个结果</div>
          <div className="results-list">
            {results.map((result) => (
              <div
                key={result.id}
                className="result-item"
                onClick={() => handleResultClick(result.id)}
              >
                <div className="result-title">
                  {result.recentlyOpen && <span>★</span>}
                  {highlightSearchTerm(result.title || "无标题", query)}
                  <span className="result-score">匹配度 {result.score}%</span>
                </div>
                {result.tags?.length > 0 && (
                  <div className="result-tags">
                    {result.tags.map((tag) => (
                      <span key={tag} className="tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                {/* excerpt 高亮，ts_headline 产物已转义安全 */}
                <div
                  className="result-content"
                  dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(result.excerpt) }}
                />
                <div className="result-meta">
                  <span className="result-channels">
                    {result.matchedBy.map((c) => (
                      <span key={c} className="channel-tag">
                        {c === "exact"
                          ? "精确命中标题"
                          : c === "semantic"
                            ? "语义匹配"
                            : c === "fuzzy"
                              ? "全文匹配"
                              : "关联召回"}
                      </span>
                    ))}
                  </span>
                  <span className="result-date">
                    {new Date(result.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* 分页栏：有结果即显示，"下一页"用 hasMore 控制禁用，避免最后一页无法返回上一页 */}
          {results.length > 0 && (
            <div className="search-pagination">
              <button disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                上一页
              </button>
              <span>第 {page} 页</span>
              <button disabled={!hasMore} onClick={() => handlePageChange(page + 1)}>
                下一页
              </button>
            </div>
          )}
          {truncated && (
            <div className="search-truncated-tip">
              匹配到 {total}+ 篇文档，建议添加更多关键词（如作者、时间范围）以缩小范围。
            </div>
          )}
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
            history.map((item) => {
              const modeLabel =
                item.mode === "smart" ? "智能" : item.mode === "keyword" ? "关键词" : "语义";
              return (
                <div
                  key={`${item.keyword}-${item.mode}`}
                  className="history-item"
                  onClick={() => handleHistoryClick(item.keyword, item.mode)}
                >
                  <History className="history-item-icon" size={18} />
                  <span className="history-item-text">{item.keyword}</span>
                  <span className={`history-mode-pill ${item.mode}`}>{modeLabel}</span>
                  {item.count > 0 && <span className="history-item-count">{item.count}</span>}
                  <button
                    className="history-item-remove"
                    onClick={(e) => handleRemoveHistory(item.keyword, e)}
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })
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
