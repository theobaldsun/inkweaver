/**
 * 文档编辑页：TipTap 编辑、Yjs 本地快照与云端同步。
 */

import { documentApi, storageApi } from '@inkweaver/api';
import { InkWeaverEditor } from '@inkweaver/editor-web';
import { sanitizeDocumentHtml } from '../utils/sanitizeDocumentHtml';
import { authService } from '@inkweaver/services';
import {
  createPushThrottle,
  type CreateDocumentRequest,
  type Document,
} from '@inkweaver/shared';
import { ArrowLeft, Eye, RefreshCw, Save } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';

import '@inkweaver/editor-web/dist/index.css';

import { showAlert } from '../components/CustomModal';
import { EditorMoreMenu } from '../components/EditorMoreMenu';
import { showToast } from '../components/Toast';
import { APP_PUBLIC_URL } from '../config/env';
import { documentService } from '../services/apiClient';
import {
  syncDocument,
  getYDoc,
  localDB,
  joinDocRoom,
  leaveDocRoom,
  onUpdate,
  offUpdate,
  onSyncConflict,
  CLIENT_ID,
  isWebSocketConnected,
  onConnectionChange,
  SYNC_REPLAY_ORIGIN,
  syncEngine,
} from '../services/syncService';
import { getAssetUrl } from '../utils/assetUrl';

/**
 * 将节流缓冲区内的 Yjs updates 立即落盘为 pending，避免切文档丢写。
 * 输入：docId、缓冲 Map；输出：无（异步写本地 DB）
 */
function flushPendingUpdateBuffer(
  docId: string,
  buffer: Map<string, Uint8Array[]>,
): void {
  const pendingUpdates = buffer.get(docId) ?? [];
  if (pendingUpdates.length === 0) return;
  buffer.delete(docId);
  const mergedUpdate = Y.mergeUpdates(pendingUpdates);
  void localDB
    .saveUpdate({
      docId,
      update: mergedUpdate,
      clientId: CLIENT_ID,
      timestamp: Date.now(),
      pending: true,
    })
    .catch(console.error);
}

const DocumentEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [document, setDocument] = useState<Document>({
    id: '',
    title: '',
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: '00000000-0000-0000-0000-000000000000',
    lastUpdateId: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [socketConnected, setSocketConnected] = useState(() => isWebSocketConnected());
  const [showPreview, setShowPreview] = useState(false);
  const [editorSyncKey, setEditorSyncKey] = useState(0);
  const yDocRef = useRef<Y.Doc | null>(null);
  const contentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaProjectionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isApplyingRemoteRef = useRef(false);
  const initializedTempDocs = useRef<Set<string>>(new Set());
  const tempUpdateDisposers = useRef<Map<string, () => void>>(new Map());
  const pendingUpdateBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());
  const pushPendingThrottleRef = useRef<ReturnType<typeof createPushThrottle<(docId: string) => void>> | null>(null);

  const [showRestoreBanner, setShowRestoreBanner] = useState(false);
  const [pendingTempDoc, setPendingTempDoc] = useState<Document | null>(null);

  /** 客户端兜底：将 title/content 防抖写回 PG，保证搜索与分享即时可见 */
  const scheduleMetadataProjection = useCallback((docId: string, title: string, content: string) => {
    if (!docId || docId.startsWith('temp-')) return;
    if (metaProjectionRef.current) clearTimeout(metaProjectionRef.current);
    metaProjectionRef.current = setTimeout(() => {
      documentService.updateDocument(docId, { title, content }).catch((err) => {
        console.error('元数据投影失败:', err);
      });
    }, 1500);
  }, []);

  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const tokens = await authService.getTokens();
        if (tokens && tokens.userId) {
          setDocument(prev => ({ ...prev, userId: tokens.userId }));
        }
      } catch (error) {
        console.error('Failed to load user info:', error);
      }
    };
    loadUserInfo();
  }, []);

  useEffect(() => onConnectionChange(setSocketConnected), []);

  const initTempDocument = useCallback((tempId: string, yDoc: Y.Doc) => {
    if (initializedTempDocs.current.has(tempId)) return;
    initializedTempDocs.current.add(tempId);

    const handleUpdate = (update: Uint8Array) => {
      localDB.saveUpdate({
        docId: tempId,
        update,
        clientId: CLIENT_ID,
        timestamp: Date.now(),
        pending: false,
      }).catch(console.error);
    };
    yDoc.on('update', handleUpdate);
    tempUpdateDisposers.current.set(tempId, () => {
      yDoc.off('update', handleUpdate);
      tempUpdateDisposers.current.delete(tempId);
    });
  }, []);

  const loadRecentTempDocument = useCallback(async () => {
    try {
      const allDocs = await localDB.getAllDocuments?.() || [];
      const tempDocs = allDocs
        .filter(doc => doc.id && doc.id.startsWith('temp-'))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      if (tempDocs.length > 0) {
        return tempDocs[0];
      }
    } catch (error) {
      console.error('Failed to load recent temp document:', error);
    }
    return null;
  }, []);

  const handleRestoreTemp = useCallback(async () => {
    if (!pendingTempDoc) return;
    const tempId = pendingTempDoc.id;
    const yDoc = getYDoc(tempId);
    yDocRef.current = yDoc;
    if (pendingTempDoc.yjsSnapshot) {
      Y.applyUpdate(yDoc, pendingTempDoc.yjsSnapshot);
    }
    const content = yDoc.getText('content').toString();
    const title = yDoc.getMap('metadata').get('title') as string || pendingTempDoc.title || '';
    const updatedDoc = { ...pendingTempDoc, title, content };
    setDocument(updatedDoc);
    initTempDocument(tempId, yDoc);
    navigate(`/documents/${tempId}`, { replace: true });
    setShowRestoreBanner(false);
    setPendingTempDoc(null);
  }, [pendingTempDoc, navigate, initTempDocument]);

  const handleDiscardTemp = useCallback(async () => {
    if (!pendingTempDoc) return;
    const tempId = pendingTempDoc.id;
    try {
      await localDB.deleteDoc?.(tempId);
      await localDB.clearPending(tempId);
      syncEngine.clearYDocCache(tempId);
      initializedTempDocs.current.delete(tempId);
    } catch (error) {
      console.error('Failed to delete temp document:', error);
    }
    setShowRestoreBanner(false);
    setPendingTempDoc(null);
    setDocument({
      id: '',
      title: '',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId: document.userId,
      lastUpdateId: 0,
    });
  }, [pendingTempDoc, document.userId]);

  useEffect(() => {
    let disposed = false;
    let cleanupListeners: (() => void) | undefined;

    const loadDocument = async () => {
      if (id) {
        const isTempDoc = id.startsWith('temp-');

        if (isTempDoc) {
          try {
            const yDoc = getYDoc(id);
            yDocRef.current = yDoc;

            const localDoc = await localDB.getDoc(id);
            if (localDoc?.yjsSnapshot) {
              try {
                Y.applyUpdate(yDoc, localDoc.yjsSnapshot);
              } catch (applyErr) {
                console.error('临时文档快照损坏，丢弃', applyErr);
                await localDB.saveDoc({ ...localDoc, yjsSnapshot: undefined });
              }
            }
            const content = yDoc.getText('content').toString();
            const title = yDoc.getMap('metadata').get('title') as string || localDoc?.title || '';
            const doc = { ...localDoc, title, content, id };
            setDocument(doc);
            initTempDocument(id, yDoc);
          } catch (error) {
            console.error('临时文档加载失败:', error);
          } finally {
            setLoading(false);
          }
          return;
        }

        try {
          try {
            await documentApi.getDocument(id);
          } catch {
            showAlert('提示', '文档不存在或已在回收站', 'error');
            navigate('/trash');
            setLoading(false);
            return;
          }

          const yDoc = getYDoc(id);
          yDocRef.current = yDoc;

          try {
            const localDoc = await localDB.getDoc(id);
            if (localDoc?.yjsSnapshot) {
              try {
                Y.applyUpdate(yDoc, localDoc.yjsSnapshot);
                setDocument(localDoc);
              } catch (applyErr) {
                console.error('本地快照损坏，丢弃并重新同步', applyErr);
                await localDB.saveDoc({ ...localDoc, yjsSnapshot: undefined });
              }
            }
          } catch (localError) {
            console.error('本地快照加载失败:', localError);
          }

          try {
            await syncDocument(id);
            const content = yDoc.getText('content').toString();
            const title = yDoc.getMap('metadata').get('title') as string || '';
            setDocument(prev => ({ ...prev, title, content, updatedAt: new Date().toISOString() }));
          } catch (syncError) {
            console.error('服务器同步失败:', syncError);
            const content = yDoc.getText('content').toString();
            const title = yDoc.getMap('metadata').get('title') as string || '';
            if (content || title) setDocument(prev => ({ ...prev, title, content }));
          }

          // 先结束 loading，WebSocket 在后台连接（失败不影响编辑）
          setLoading(false);

          const handleRemoteUpdates = (updates: Uint8Array[]) => {
            for (const update of updates) {
              Y.applyUpdate(yDoc, update, SYNC_REPLAY_ORIGIN);
            }
          };
          void joinDocRoom(id)
            .then(() => {
              if (!disposed) onUpdate(id, handleRemoteUpdates);
            })
            .catch(console.error);

          if (!pushPendingThrottleRef.current) {
            pushPendingThrottleRef.current = createPushThrottle(
              (docId: string) => {
                flushPendingUpdateBuffer(docId, pendingUpdateBufferRef.current);
              },
              400,
            );
          }

          const handleUpdate = (update: Uint8Array, origin: unknown) => {
            if (origin !== SYNC_REPLAY_ORIGIN) {
              const pendingUpdates = pendingUpdateBufferRef.current.get(id) ?? [];
              pendingUpdates.push(update);
              pendingUpdateBufferRef.current.set(id, pendingUpdates);
              pushPendingThrottleRef.current?.(id);
            }
            if (origin === 'local-edit') return;
            isApplyingRemoteRef.current = true;
            const content = yDoc.getText('content').toString();
            setDocument(prev => ({ ...prev, content, updatedAt: new Date().toISOString() }));
            setEditorSyncKey((k) => k + 1);
            isApplyingRemoteRef.current = false;
          };

          const yMap = yDoc.getMap('metadata');
          const handleMapUpdate = () => {
            const newTitle = yMap.get('title') as string || '';
            setDocument(prev => {
              const updated = { ...prev, title: newTitle, updatedAt: new Date().toISOString() };
              localDB.saveDoc(updated).catch(console.error);
              return updated;
            });
          };

          yDoc.on('update', handleUpdate);
          yMap.observe(handleMapUpdate);
          cleanupListeners = () => {
            flushPendingUpdateBuffer(id, pendingUpdateBufferRef.current);
            void leaveDocRoom(id);
            offUpdate(id, handleRemoteUpdates);
            yDoc.off('update', handleUpdate);
            yMap.unobserve(handleMapUpdate);
          };
          if (disposed) {
            cleanupListeners();
            cleanupListeners = undefined;
          }
        } catch (error) {
          console.error('文档加载失败:', error);
          setLoading(false);
        }
      } else {
        const recentTemp = await loadRecentTempDocument();
        if (recentTemp && recentTemp.id) {
          setPendingTempDoc(recentTemp);
          setShowRestoreBanner(true);
        }
        setLoading(false);
      }
    };
    void loadDocument();
    return () => {
      disposed = true;
      if (id?.startsWith('temp-')) {
        tempUpdateDisposers.current.get(id)?.();
      }
      cleanupListeners?.();
      cleanupListeners = undefined;
    };
  }, [id, loadRecentTempDocument, initTempDocument, navigate]);

  useEffect(() => {
    if (!id || id.startsWith('temp-')) return;
    return onSyncConflict((conflictDocId) => {
      if (conflictDocId !== id) return;
      syncDocument(id)
        .then(() => setEditorSyncKey((k) => k + 1))
        .catch(console.error);
    });
  }, [id]);

  const saveDocument = async () => {
    setSaving(true);
    try {
      let currentId = id;
      let currentDoc = document;

      if (!currentId) {
        const tempId = document.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        if (!document.id) {
          currentDoc = { ...document, id: tempId };
          setDocument(currentDoc);
        }
        currentId = tempId;
      }

      const docToSave = { ...currentDoc, updatedAt: new Date().toISOString() };
      await localDB.saveDoc(docToSave);

      if (currentId && !currentId.startsWith('temp-')) {
        await syncDocument(currentId);
      } else {
        const tempYDoc = getYDoc(currentId);
        const text = tempYDoc.getText('content');
        const yMap = tempYDoc.getMap('metadata');
        const latestContent = text.toString();
        const latestTitle = (yMap.get('title') as string) || currentDoc.title || 'Untitled Document';
        
        const createData: CreateDocumentRequest = {
          title: latestTitle,
          content: latestContent,
        };
        const response = await documentApi.createDocument(createData);
        
        await cleanupTempDocument(currentId);
        
        setDocument({
          ...currentDoc,
          id: response.id,
          title: latestTitle,
          content: latestContent,
          updatedAt: new Date().toISOString()
        });
        
        navigate(`/documents/${response.id}`);
      }
      showAlert('成功', '文档保存成功！', 'success');
    } catch (error) {
      console.error('Failed to save document:', error);
      showAlert('提示', '文档已保存到本地，将在网络可用时同步。', 'info');
    } finally {
      setSaving(false);
    }
  };

  const cleanupTempDocument = async (tempId: string) => {
    try {
      await localDB.clearPending(tempId);
      await localDB.deleteDoc?.(tempId);
      syncEngine.clearYDocCache(tempId);
      initializedTempDocs.current.delete(tempId);
    } catch (error) {
      console.error('Failed to cleanup temp document:', error);
    }
  };

  const handleTitleChange = (title: string) => {
    if (id) {
      const yDoc = getYDoc(id);
      yDoc.getMap('metadata').set('title', title);
      setDocument(prev => {
        scheduleMetadataProjection(id, title, prev.content);
        return { ...prev, title, updatedAt: new Date().toISOString() };
      });
    } else {
      const tempId = document.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const yDoc = getYDoc(tempId);
      initTempDocument(tempId, yDoc);
      yDoc.getMap('metadata').set('title', title);
      setDocument(prev => {
        const updated = { ...prev, id: tempId, title, updatedAt: new Date().toISOString() };
        localDB.saveDoc(updated).catch(console.error);
        return updated;
      });
    }
  };

  const applyContentToYDoc = (docId: string, html: string) => {
    const yDoc = getYDoc(docId);
    yDoc.transact(() => {
      const text = yDoc.getText('content');
      text.delete(0, text.length);
      text.insert(0, html);
    }, 'local-edit');
  };

  const handleContentChange = (event: { content: string }) => {
    if (isApplyingRemoteRef.current) return;

    const syncToYDoc = (docId: string) => {
      if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
      contentDebounceRef.current = setTimeout(() => {
        applyContentToYDoc(docId, event.content);
      }, 300);
    };

    if (id) {
      syncToYDoc(id);
      setDocument(prev => {
        scheduleMetadataProjection(id, prev.title, event.content);
        return { ...prev, content: event.content, updatedAt: new Date().toISOString() };
      });
    } else {
      const tempId = document.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const yDoc = getYDoc(tempId);
      initTempDocument(tempId, yDoc);
      syncToYDoc(tempId);
      setDocument(prev => {
        const updated = { ...prev, id: tempId, content: event.content, updatedAt: new Date().toISOString() };
        localDB.saveDoc(updated).catch(console.error);
        return updated;
      });
    }
  };

  useEffect(() => {
    if (!id && (document.title || document.content)) {
      const tempId = document.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const tempDoc = { ...document, id: tempId, updatedAt: new Date().toISOString() };
      localDB.saveDoc(tempDoc).catch(console.error);
    }
  }, [document.title, document.content, id]);

  const handleImageUpload = async (file: File): Promise<string> => {
    try {
      const { url } = await storageApi.uploadAsset(file);
      return getAssetUrl(url);
    } catch (error) {
      console.error('Image upload failed:', error);
      showToast('图片上传失败，请稍后重试', 'error');
      throw error;
    }
  };

  const handleSync = useCallback(async () => {
    if (!id) return;
    setSyncing(true);
    try {
      await syncDocument(id);
      showAlert('同步成功', '文档已同步到云端', 'success');
    } catch (error) {
      console.error('Sync failed:', error);
      showAlert('同步失败', '无法连接到服务器，请稍后重试', 'error');
    } finally {
      setSyncing(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      if (!isWebSocketConnected()) {
        syncDocument(id).catch(console.error);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [id]);

  const handleGoBack = () => {
    navigate('/notes');
  };

  const handleCopyLink = async () => {
    if (!id) {
      showAlert('提示', '请先保存文档后再复制链接', 'info');
      return;
    }
    const link = `${window.location.origin}/documents/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('链接已复制到剪贴板', 'success');
    } catch {
      showAlert('复制链接', link, 'info');
    }
  };

  const handleExportHtml = () => {
    const title = document.title || '无标题文档';
    const blob = new Blob(
      [`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${document.content || ''}</body></html>`],
      { type: 'text/html;charset=utf-8' },
    );
    const a = window.document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已导出 HTML 文件', 'success');
  };

  const handleTogglePublic = async () => {
    if (!id) {
      showAlert('提示', '请先保存文档', 'info');
      return;
    }
    try {
      const next = !document.isPublic;
      await documentService.updateDocument(id, { isPublic: next });
      setDocument((prev) => ({ ...prev, isPublic: next }));
      showToast(next ? '文档已设为公开' : '已取消公开', 'success');
    } catch (error) {
      console.error('Toggle public failed:', error);
      showAlert('操作失败', '无法更新公开状态', 'error');
    }
  };

  const handleGenerateShareLink = async () => {
    if (!id) {
      showAlert('提示', '请先保存文档', 'info');
      return;
    }
    if (!document.isPublic) {
      showAlert('提示', '请先将文档设为公开', 'info');
      return;
    }
    try {
      const { shareUrl } = await documentApi.generateShareLink(id);
      const url = shareUrl || `${APP_PUBLIC_URL}/shared/${id}`;
      await navigator.clipboard.writeText(url);
      showToast('公开分享链接已复制', 'success');
    } catch (error) {
      console.error('Share link failed:', error);
      showAlert('操作失败', '无法生成分享链接', 'error');
    }
  };

  if (loading) {
    return (
      <div className="editor-loading">
        <div className="loading-spinner"></div>
        <div className="loading-text">加载中...</div>
      </div>
    );
  }

  return (
    <div className="editor-page">
      <div className="editor-header">
        <div className="editor-header-left">
          <button className="editor-btn secondary" onClick={handleGoBack}>
            <ArrowLeft size={18} />
          </button>
        </div>
        
        <div className="editor-header-center">
          <span className="document-status">
            {socketConnected ? '🟢 已连接' : '🔴 离线'}
          </span>
        </div>
        
        <div className="editor-header-right">
          <button 
            className="editor-btn secondary" 
            onClick={() => setShowPreview(!showPreview)}
            title="预览模式"
          >
            <Eye size={18} />
            <span>{showPreview ? '编辑' : '预览'}</span>
          </button>
          
          <button 
            className="editor-btn secondary" 
            onClick={handleSync} 
            disabled={syncing || !id}
            title="同步到云端"
          >
            <RefreshCw size={18} className={syncing ? 'spinning' : ''} />
            <span>{syncing ? '同步中' : '同步'}</span>
          </button>
          
          <button 
            className="editor-btn primary" 
            onClick={saveDocument} 
            disabled={saving}
          >
            <Save size={18} />
            <span>{saving ? '保存中' : '保存'}</span>
          </button>
          
          <EditorMoreMenu
            docId={id}
            isPublic={document.isPublic}
            onCopyLink={() => void handleCopyLink()}
            onExportHtml={handleExportHtml}
            onTogglePublic={() => void handleTogglePublic()}
            onGenerateShareLink={() => void handleGenerateShareLink()}
          />
        </div>
      </div>

      {showRestoreBanner && pendingTempDoc && (
        <div className="restore-banner">
          <span>📝 检测到上次未保存的草稿：{pendingTempDoc.title || '无标题'}</span>
          <div className="banner-actions">
            <button className="banner-btn primary" onClick={handleRestoreTemp}>
              恢复
            </button>
            <button className="banner-btn secondary" onClick={handleDiscardTemp}>
              忽略
            </button>
          </div>
        </div>
      )}

      <div className="editor-content">
        {showPreview ? (
          <div className="preview-content">
            <div className="preview-title">{document.title || '无标题'}</div>
            <div 
              className="preview-body" 
              dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(document.content || '<p>暂无内容</p>') }}
            />
          </div>
        ) : (
          <InkWeaverEditor
            key={`${document.id}-${editorSyncKey}`}
            content={document.content}
            onChange={handleContentChange}
            title={document.title}
            onTitleChange={handleTitleChange}
            imageUploader={handleImageUpload}
          />
        )}
      </div>
    </div>
  );
};

export default DocumentEditPage;
