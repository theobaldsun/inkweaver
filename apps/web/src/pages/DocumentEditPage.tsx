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
  subscribeDocRoom,
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

interface EditorErrorBoundaryState {
  hasError: boolean;
}

/**
 * 编辑器错误边界：捕获 InkWeaverEditor 渲染异常，避免整页白屏
 */
class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  EditorErrorBoundaryState
> {
  state: EditorErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): EditorErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('InkWeaverEditor 渲染异常:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-loading">
          <div className="loading-text">编辑器加载失败</div>
          <button className="editor-btn primary" onClick={this.handleReload}>
            刷新重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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
  const yDocRef = useRef<Y.Doc | null>(null);
  const contentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaProjectionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 同步指向最新 document state，供 yMap.observe / handleContentChange 等闭包回调读取
   * 避免 setDocument(prev => {...}) updater 内部执行 side effect（StrictMode 双调用安全）
   */
  const documentRef = useRef(document);
  documentRef.current = document;
  const initializedTempDocs = useRef<Set<string>>(new Set());
  const tempUpdateDisposers = useRef<Map<string, () => void>>(new Map());
  const pendingUpdateBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());
  const pushPendingThrottleRef = useRef<ReturnType<typeof createPushThrottle<(docId: string) => void>> | null>(null);

  const [showRestoreBanner, setShowRestoreBanner] = useState(false);
  const [pendingTempDoc, setPendingTempDoc] = useState<Document | null>(null);

  /**
   * 客户端兜底：将 title/content 防抖写回 PG，保证搜索与分享即时可见
   *
   * 仅在 handleTitleChange / handleContentChange 内部调用，未进入任何 hook 依赖数组，
   * 因此使用普通函数即可，无需 useCallback 包装
   */
  const scheduleMetadataProjection = (docId: string, title: string, content: string) => {
    if (!docId || docId.startsWith('temp-')) return;
    if (metaProjectionRef.current) clearTimeout(metaProjectionRef.current);
    metaProjectionRef.current = setTimeout(() => {
      documentService.updateDocument(docId, { title, content }).catch((err) => {
        console.error('元数据投影失败:', err);
      });
    }, 1500);
  };

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

  // 新建文档场景下稳定持有 tempId，避免散落生成导致 document.id 被反复写回
  // tempId 仅在此 ref 内流转，不写入 document state，直到 saveDocument 成功转正
  const tempIdRef = useRef<string | null>(null);

  // 首次调用时生成 tempId 并初始化 Y.Doc，后续调用稳定返回同一值
  const ensureTempId = useCallback((): string => {
    if (tempIdRef.current) return tempIdRef.current;
    const newId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    tempIdRef.current = newId;
    const yDoc = getYDoc(newId);
    initTempDocument(newId, yDoc);
    return newId;
  }, [initTempDocument]);

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

  /**
   * 恢复上次未保存的临时文档：把 yjs 快照应用到 Y.Doc，再切到该 tempId 路由
   *
   * 仅作为 onClick 传给原生 <button>，子组件未用 React.memo，引用稳定无收益，无需 useCallback
   */
  const handleRestoreTemp = async () => {
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
  };

  /**
   * 丢弃临时文档：清理 localDB 与 Y.Doc 缓存，重置编辑器为空白新建态
   *
   * 仅作为 onClick 传给原生 <button>，子组件未用 React.memo，引用稳定无收益，无需 useCallback
   */
  const handleDiscardTemp = async () => {
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
      userId: documentRef.current.userId,
      lastUpdateId: 0,
    });
  };

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
            showAlert('提示', '本地草稿加载失败，请尝试新建文档', 'error');
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
            if (!disposed) setLoading(false);
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
          // subscribeDocRoom 内部用引用计数管理 join-doc/leave-doc，
          // 自动消除 await connectSocket 期间切走导致的"加入后永不离开"竞态
          const unsubscribeDocRoom = subscribeDocRoom(id, handleRemoteUpdates);

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
            // 远端更新：同步 React state。InkWeaverEditor 的 setContent(content, false)
            // 不会触发 onUpdate，无回声循环风险，无需 isApplyingRemoteRef 防护
            const content = yDoc.getText('content').toString();
            setDocument(prev => {
              if (prev.content === content) return prev;
              return { ...prev, content, updatedAt: new Date().toISOString() };
            });
          };

          const yMap = yDoc.getMap('metadata');
          // yMap.observe 回调：远端或本地写入 title 时触发
          // 统一负责：等值短路 + localDB 落盘 + PG 元数据投影（正式文档）
          // 本地 handleTitleChange 写入 Yjs 后也会触发此回调，此时 PG 投影在此完成
          const handleMapUpdate = () => {
            const newTitle = yMap.get('title') as string || '';
            const prev = documentRef.current;
            if (prev.title === newTitle) return;
            const updated = { ...prev, title: newTitle, updatedAt: new Date().toISOString() };
            documentRef.current = updated;
            localDB.saveDoc(updated).catch(console.error);
            // 正式文档：投影 title 到 PG（content 由 handleContentChange 中的 scheduleMetadataProjection 或
            // 此处的 yMap.observe 配合完成，保证搜索与分享即时可见）
            if (id) {
              scheduleMetadataProjection(id, newTitle, prev.content);
            }
            setDocument(updated);
          };

          yDoc.on('update', handleUpdate);
          yMap.observe(handleMapUpdate);
          cleanupListeners = () => {
            flushPendingUpdateBuffer(id, pendingUpdateBufferRef.current);
            unsubscribeDocRoom();
            yDoc.off('update', handleUpdate);
            yMap.unobserve(handleMapUpdate);
          };
          if (disposed) {
            cleanupListeners();
            cleanupListeners = undefined;
          }
        } catch (error) {
          console.error('文档加载失败:', error);
          showAlert('提示', '文档加载失败，请返回重试', 'error');
          if (!disposed) setLoading(false);
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
      // id 变化（切文档）时清理 contentDebounce，避免把 A 文档内容写入 B 的 Yjs
      if (contentDebounceRef.current) {
        clearTimeout(contentDebounceRef.current);
        contentDebounceRef.current = null;
      }
      if (id?.startsWith('temp-')) {
        tempUpdateDisposers.current.get(id)?.();
      }
      cleanupListeners?.();
      cleanupListeners = undefined;
    };
  }, [id, loadRecentTempDocument, initTempDocument, navigate]);

  useEffect(() => {
    if (!id || id.startsWith('temp-')) return;
    let active = true;
    const off = onSyncConflict((conflictDocId) => {
      if (conflictDocId !== id || !active) return;
      syncDocument(id).catch(console.error);
    });
    return () => {
      active = false;
      off();
    };
  }, [id]);

  /**
   * 组件卸载时清理所有定时器与节流器，防止：
   * 1. contentDebounceRef 触发 applyContentToYDoc 操作已卸载的 Y.Doc
   * 2. metaProjectionRef 触发 documentService.updateDocument 调用已卸载组件的数据
   * 3. pushPendingThrottleRef 内部 timer 持有闭包引用造成内存泄漏
   */
  useEffect(() => {
    return () => {
      if (contentDebounceRef.current) {
        clearTimeout(contentDebounceRef.current);
        contentDebounceRef.current = null;
      }
      if (metaProjectionRef.current) {
        clearTimeout(metaProjectionRef.current);
        metaProjectionRef.current = null;
      }
      pushPendingThrottleRef.current?.cancel();
      pushPendingThrottleRef.current = null;
    };
  }, []);

  const saveDocument = async () => {
    setSaving(true);
    try {
      // 新建文档：用 ensureTempId 获取稳定 tempId，不再写回 document.id
      const currentId = id || ensureTempId();

      const docToSave = { ...document, id: currentId, updatedAt: new Date().toISOString() };
      await localDB.saveDoc(docToSave);

      if (currentId && !currentId.startsWith('temp-')) {
        await syncDocument(currentId);
      } else {
        // 临时文档转正：从 Y.Doc 读取最新内容，调用 createDocument 落库
        const tempYDoc = getYDoc(currentId);
        const text = tempYDoc.getText('content');
        const yMap = tempYDoc.getMap('metadata');
        const latestContent = text.toString();
        const latestTitle = (yMap.get('title') as string) || document.title || 'Untitled Document';

        const createData: CreateDocumentRequest = {
          title: latestTitle,
          content: latestContent,
        };
        const response = await documentApi.createDocument(createData);

        // 清理临时文档数据；失败不阻塞转正（文档已在服务端创建，残留 temp 数据可后续清理）
        let cleanupOk = false;
        try {
          await cleanupTempDocument(currentId);
          cleanupOk = true;
        } catch (cleanupError) {
          console.error('临时文档清理失败:', cleanupError);
        }
        tempIdRef.current = null;
        setDocument({
          ...document,
          id: response.id,
          title: latestTitle,
          content: latestContent,
          updatedAt: new Date().toISOString()
        });
        navigate(`/documents/${response.id}`);
        showAlert(
          cleanupOk ? '成功' : '提示',
          cleanupOk ? '文档保存成功！' : '文档已保存，本地草稿清理失败，残留数据不影响使用',
          cleanupOk ? 'success' : 'info',
        );
      }
    } catch (error) {
      console.error('Failed to save document:', error);
      showAlert('提示', '文档已保存到本地，将在网络可用时同步。', 'info');
    } finally {
      setSaving(false);
    }
  };

  // 清理临时文档数据，失败时抛出由调用方决定是否重置 tempIdRef
  const cleanupTempDocument = async (tempId: string) => {
    await localDB.clearPending(tempId);
    await localDB.deleteDoc?.(tempId);
    syncEngine.clearYDocCache(tempId);
    initializedTempDocs.current.delete(tempId);
  };

  // 标题变更：写入 Yjs metadata + 同步 React state
  // tempId 由 ensureTempId 稳定持有，不写回 document.id，避免触发 InkWeaverEditor key 变化
  // 使用 transact + 'local-edit' origin，与 content 写入统一标记，供 handleUpdate 识别跳过
  // PG 元数据投影由 yMap.observe 回调统一完成，避免重复调度
  const handleTitleChange = (title: string) => {
    const docId = id || ensureTempId();
    const yDoc = getYDoc(docId);
    yDoc.transact(() => {
      yDoc.getMap('metadata').set('title', title);
    }, 'local-edit');

    // 等值短路 + side effect 在 setDocument 外部执行（StrictMode 双调用安全）
    const prev = documentRef.current;
    if (prev.title === title) return;

    const updated = { ...prev, title, updatedAt: new Date().toISOString() };
    documentRef.current = updated;

    // 临时文档落盘 localDB（正式文档由 yMap.observe 回调统一保存 + PG 投影）
    if (!id) {
      localDB.saveDoc({ ...updated, id: docId }).catch(console.error);
    }

    setDocument(updated);
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
    const docId = id || ensureTempId();

    // 防抖写入 Yjs（local-edit origin），handleUpdate 会跳过 local-edit，无回声循环
    if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
    contentDebounceRef.current = setTimeout(() => {
      applyContentToYDoc(docId, event.content);
    }, 300);

    // 等值短路
    const prev = documentRef.current;
    if (prev.content === event.content) return;

    const updated = { ...prev, content: event.content, updatedAt: new Date().toISOString() };
    documentRef.current = updated;

    // side effect 在 setDocument 外部执行（StrictMode 双调用安全）
    if (id) {
      // 正式文档：防抖写回 PG 元数据，保证搜索与分享即时可见
      scheduleMetadataProjection(id, prev.title, event.content);
    } else {
      // 临时文档：立即落盘 localDB，确保离线可恢复
      localDB.saveDoc({ ...updated, id: docId }).catch(console.error);
    }

    setDocument(updated);
  };

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

  /**
   * 手动触发同步：调用 syncDocument 推送本地 Yjs 更新到云端
   *
   * 仅作为 onClick 传给原生 <button>，子组件未用 React.memo，引用稳定无收益，无需 useCallback
   */
  const handleSync = async () => {
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
  };

  // 断线重连轮询：失败时指数退避（30s → 60s → 120s → 240s，上限 240s），成功或恢复连接后重置
  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const delays = [30000, 60000, 120000, 240000];

    const scheduleNext = () => {
      const delay = delays[Math.min(attempt, delays.length - 1)];
      timer = setTimeout(async () => {
        // 已恢复连接：重置退避计数，继续轮询监控下次断线
        if (isWebSocketConnected()) {
          attempt = 0;
          scheduleNext();
          return;
        }
        try {
          await syncDocument(id);
          attempt = 0;
        } catch (err) {
          console.error('断线重连同步失败:', err);
          attempt += 1;
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      if (timer) clearTimeout(timer);
    };
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
    // title 转 HTML 文本节点再提取，避免 </title><script> 等注入
    const escapedTitle = new Option(title).innerHTML;
    const safeContent = sanitizeDocumentHtml(document.content || '<p>暂无内容</p>');
    const blob = new Blob(
      [`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapedTitle}</title></head><body>${safeContent}</body></html>`],
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
          <EditorErrorBoundary>
            <InkWeaverEditor
              key={id || 'new'}
              content={document.content}
              onChange={handleContentChange}
              title={document.title}
              onTitleChange={handleTitleChange}
              imageUploader={handleImageUpload}
            />
          </EditorErrorBoundary>
        )}
      </div>
    </div>
  );
};

export default DocumentEditPage;
