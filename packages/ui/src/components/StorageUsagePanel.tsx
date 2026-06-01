/**
 * 存储用量展示面板（Web / H5）。
 *
 * 用途：显示字节数、格式化大小、进度条与同步状态。
 */

import React from 'react';
import { formatStorageSize } from '@inkweaver/shared';
import { useStorageUsage } from '../hooks/useStorageUsage';

export interface StorageUsagePanelProps {
  className?: string;
  compact?: boolean;
  pollIntervalMs?: number;
}

export const StorageUsagePanel: React.FC<StorageUsagePanelProps> = ({
  className = '',
  compact = false,
  pollIntervalMs = 60_000,
}) => {
  const { usage, loading, error, refresh } = useStorageUsage({ pollIntervalMs });

  const usedBytes = usage?.usedBytes ?? 0;
  const quotaBytes = usage?.quotaBytes ?? 0;
  const percent = usage?.usagePercent ?? 0;
  const barColor =
    percent >= 90 ? '#ef4444' : percent >= 70 ? '#f59e0b' : '#3b82f6';

  return (
    <div className={`storage-usage-panel ${className}`.trim()}>
      <div className="storage-usage-panel__header">
        <h3 className="storage-usage-panel__title">存储空间</h3>
        <button
          type="button"
          className="storage-usage-panel__refresh"
          onClick={() => void refresh(true)}
          disabled={loading}
        >
          {loading ? '同步中…' : '刷新'}
        </button>
      </div>

      {error && (
        <p className="storage-usage-panel__error" role="alert">
          {error}
          {usage?.stale ? '（显示上次缓存）' : ''}
        </p>
      )}

      <div className="storage-usage-panel__metrics">
        <div className="storage-usage-panel__primary">
          <span className="storage-usage-panel__formatted">
            {formatStorageSize(usedBytes)}
          </span>
          <span className="storage-usage-panel__of">
            / {formatStorageSize(quotaBytes)}
          </span>
        </div>
        <p className="storage-usage-panel__bytes">
          {usedBytes.toLocaleString()} / {quotaBytes.toLocaleString()} 字节
        </p>
      </div>

      <div
        className="storage-usage-panel__bar-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="存储使用进度"
      >
        <div
          className="storage-usage-panel__bar-fill"
          style={{ width: `${Math.min(100, percent)}%`, backgroundColor: barColor }}
        />
      </div>
      <p className="storage-usage-panel__percent">{percent}% 已使用</p>

      {!compact && usage && (
        <div className="storage-usage-panel__breakdown">
          <div className="storage-usage-panel__breakdown-row">
            <span>文档内容</span>
            <span>{formatStorageSize(usage.documentDataBytes)}</span>
          </div>
          <div className="storage-usage-panel__breakdown-row">
            <span>同步数据</span>
            <span>{formatStorageSize(usage.syncDataBytes)}</span>
          </div>
          <div className="storage-usage-panel__breakdown-row">
            <span>笔记数</span>
            <span>{usage.documentCount}</span>
          </div>
          <div className="storage-usage-panel__breakdown-row">
            <span>文件夹</span>
            <span>{usage.folderCount}</span>
          </div>
        </div>
      )}

      {usage?.lastUpdatedAt && (
        <p className="storage-usage-panel__updated">
          更新于 {new Date(usage.lastUpdatedAt).toLocaleString()}
        </p>
      )}

      <style>{`
        .storage-usage-panel {
          padding: 16px;
          border-radius: 12px;
          background: var(--surface-secondary, #f8fafc);
          border: 1px solid var(--border-color, #e2e8f0);
        }
        .storage-usage-panel__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .storage-usage-panel__title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary, #0f172a);
        }
        .storage-usage-panel__refresh {
          font-size: 13px;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid #cbd5e1;
          background: #fff;
          cursor: pointer;
        }
        .storage-usage-panel__refresh:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .storage-usage-panel__error {
          color: #dc2626;
          font-size: 13px;
          margin: 0 0 8px;
        }
        .storage-usage-panel__primary {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .storage-usage-panel__formatted {
          font-size: 22px;
          font-weight: 700;
          color: #0f172a;
        }
        .storage-usage-panel__of {
          font-size: 14px;
          color: #64748b;
        }
        .storage-usage-panel__bytes {
          font-size: 12px;
          color: #94a3b8;
          margin: 4px 0 12px;
        }
        .storage-usage-panel__bar-track {
          height: 10px;
          background: #e2e8f0;
          border-radius: 999px;
          overflow: hidden;
        }
        .storage-usage-panel__bar-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 0.3s ease;
        }
        .storage-usage-panel__percent {
          font-size: 12px;
          color: #64748b;
          margin: 6px 0 0;
        }
        .storage-usage-panel__breakdown {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid #e2e8f0;
        }
        .storage-usage-panel__breakdown-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: #475569;
          padding: 4px 0;
        }
        .storage-usage-panel__updated {
          font-size: 11px;
          color: #94a3b8;
          margin: 12px 0 0;
        }
      `}</style>
    </div>
  );
};
