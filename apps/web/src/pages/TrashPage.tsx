/**
 * 回收站页面
 *
 * 用途：展示已删除文档、恢复、永久删除与清空回收站
 */

import { TRASH_RETENTION_DAYS } from '@inkweaver/shared';
import { Trash2, RotateCcw, FileText, Loader2, AlertTriangle } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import CustomModal from '../components/CustomModal';
import { documentService } from '../services/apiClient';


import type { Document } from '@inkweaver/shared';


interface TrashItem extends Document {
  purgeAt?: string;
}

/**
 * 计算距离永久删除的剩余天数
 */
function getDaysRemaining(purgeAt?: string): number {
  if (!purgeAt) return TRASH_RETENTION_DAYS;
  const diff = new Date(purgeAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export const TrashPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{
    type: 'purge' | 'empty';
    docId?: string;
    title?: string;
  } | null>(null);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await documentService.getTrashDocuments(1, 100);
      setItems(res.documents as TrashItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载回收站失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const handleRestore = async (docId: string) => {
    try {
      await documentService.restoreDocument(docId);
      setItems((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败');
    }
  };

  const handlePermanentDelete = async () => {
    if (!confirm?.docId) return;
    try {
      await documentService.permanentDeleteDocument(confirm.docId);
      setItems((prev) => prev.filter((d) => d.id !== confirm.docId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '永久删除失败');
    } finally {
      setConfirm(null);
    }
  };

  const handleEmptyTrash = async () => {
    try {
      await documentService.emptyTrash();
      setItems([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空回收站失败');
    } finally {
      setConfirm(null);
    }
  };

  const formatDeletedAt = (iso?: string) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString();
  };

  return (
    <div className="trash-page">
      <div className="trash-page__header">
        <div>
          <h1 className="trash-page__title">回收站</h1>
          <p className="trash-page__subtitle">
            删除的文档将保留 {TRASH_RETENTION_DAYS} 天，之后自动永久清除
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            className="btn btn-danger trash-page__empty-btn"
            onClick={() => setConfirm({ type: 'empty' })}
          >
            <Trash2 size={18} />
            清空回收站
          </button>
        )}
      </div>

      {error && (
        <div className="trash-page__error" role="alert">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <Loader2 className="loading-spinner" />
          <span className="loading-text">加载中...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="trash-page__empty">
          <Trash2 size={48} strokeWidth={1.2} />
          <p>回收站为空</p>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/notes')}>
            返回文档列表
          </button>
        </div>
      ) : (
        <div className="trash-page__list">
          {items.map((item) => {
            const daysLeft = getDaysRemaining(item.purgeAt);
            const percentUsed = Math.min(
              100,
              ((TRASH_RETENTION_DAYS - daysLeft) / TRASH_RETENTION_DAYS) * 100,
            );
            return (
              <div key={item.id} className="trash-page__item">
                <div className="trash-page__item-main">
                  <FileText size={20} className="trash-page__item-icon" />
                  <div className="trash-page__item-info">
                    <h3 className="trash-page__item-title">{item.title || '无标题文档'}</h3>
                    <p className="trash-page__item-meta">
                      删除于 {formatDeletedAt(item.deletedAt)}
                    </p>
                    <div className="trash-page__progress-track">
                      <div
                        className="trash-page__progress-fill"
                        style={{ width: `${percentUsed}%` }}
                      />
                    </div>
                    <p className="trash-page__item-days">
                      {daysLeft > 0 ? `${daysLeft} 天后永久删除` : '即将永久删除'}
                    </p>
                  </div>
                </div>
                <div className="trash-page__item-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleRestore(item.id)}
                    title="恢复"
                  >
                    <RotateCcw size={16} />
                    恢复
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() =>
                      setConfirm({
                        type: 'purge',
                        docId: item.id,
                        title: item.title || '无标题文档',
                      })
                    }
                    title="永久删除"
                  >
                    <Trash2 size={16} />
                    永久删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CustomModal
        isOpen={confirm?.type === 'purge'}
        title="永久删除"
        message={`确定要永久删除「${confirm?.title}」吗？此操作无法恢复。`}
        onConfirm={() => void handlePermanentDelete()}
        onCancel={() => setConfirm(null)}
      />

      <CustomModal
        isOpen={confirm?.type === 'empty'}
        title="清空回收站"
        message={`确定要永久删除回收站中的全部 ${items.length} 篇文档吗？此操作无法恢复。`}
        onConfirm={() => void handleEmptyTrash()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
};

export default TrashPage;
