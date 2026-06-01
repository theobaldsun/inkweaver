/**
 * 文档编辑页面
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InkWeaverEditor } from '@inkweaver/editor-web';
import { documentApi } from '@inkweaver/api';
import { authService } from '@inkweaver/services';
import { syncDocument, getYDoc, localDB, joinDocRoom, onUpdate, CLIENT_ID, isWebSocketConnected } from '../services/syncService';
import * as Y from 'yjs';
import { syncEngine } from '../services/syncService';
import type { Document, CreateDocumentRequest } from '@inkweaver/shared';
import { showAlert } from '../components/CustomModal';

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
  const [saving, setSaving] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const yDocRef = useRef<Y.Doc | null>(null);
  const initializedTempDocs = useRef<Set<string>>(new Set());

  // Banner 相关状态
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);
  const [pendingTempDoc, setPendingTempDoc] = useState<Document | null>(null);

  // 加载用户信息
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

  // 统一初始化临时文档
  const initTempDocument = useCallback((tempId: string, yDoc: Y.Doc, skipWebSocket = false) => {
    if (initializedTempDocs.current.has(tempId)) return;
    initializedTempDocs.current.add(tempId);

    // 临时文档不加入WebSocket房间，避免产生需要上传的更新
    // if (!skipWebSocket) {
    //   joinDocRoom(tempId).catch(error => {
    //     console.error('Failed to join WebSocket room for temp document:', error);
    //   });
    // }

    // 临时文档的更新只在本地保存，不上传到服务端
    const handleUpdate = (update: Uint8Array) => {
      localDB.saveUpdate({
        docId: tempId,
        update,
        clientId: CLIENT_ID,
        timestamp: Date.now(),
        pending: false, // 临时文档的更新标记为已同步，不上传
      }).catch(console.error);
    };
    yDoc.on('update', handleUpdate);
  }, []);

  // 从本地存储加载最近的临时文档
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

  // 恢复临时文档
  const handleRestoreTemp = useCallback(async () => {
    if (!pendingTempDoc) return;
    const tempId = pendingTempDoc.id;
    console.log('Restoring unsaved temp document:', tempId);
    const yDoc = getYDoc(tempId);
    yDocRef.current = yDoc;
    if (pendingTempDoc.yjsSnapshot) {
      Y.applyUpdate(yDoc, pendingTempDoc.yjsSnapshot);
    }
    // 从 Yjs 文档中读取最新内容
    const content = yDoc.getText('content').toString();
    const title = yDoc.getMap('metadata').get('title') as string || pendingTempDoc.title || '';
    const updatedDoc = { ...pendingTempDoc, title, content };
    setDocument(updatedDoc);
    initTempDocument(tempId, yDoc);
    navigate(`/documents/${tempId}`, { replace: true });
    setShowRestoreBanner(false);
    setPendingTempDoc(null);
  }, [pendingTempDoc, navigate, initTempDocument]);

  // 忽略临时文档（删除本地数据）
  const handleDiscardTemp = useCallback(async () => {
    if (!pendingTempDoc) return;
    const tempId = pendingTempDoc.id;
    try {
      await localDB.deleteDoc?.(tempId);
      await localDB.clearPending(tempId);
      syncEngine.clearYDocCache(tempId);
      initializedTempDocs.current.delete(tempId);
      console.log('Deleted unsaved temp document:', tempId);
    } catch (error) {
      console.error('Failed to delete temp document:', error);
    }
    setShowRestoreBanner(false);
    setPendingTempDoc(null);
    // 重置文档状态，确保空白编辑器
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

  // 加载文档（已有 id）
  useEffect(() => {
    const loadDocument = async () => {
      if (id) {
        // 检查是否为临时文档（本地草稿）
        const isTempDoc = id.startsWith('temp-');

        if (isTempDoc) {
          // 临时文档：仅从本地加载，不同步服务器，不建立 WebSocket
          try {
            console.log('加载临时文档（仅本地）:', id);
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
            // 从 Yjs 文档中读取最新内容
            const content = yDoc.getText('content').toString();
            const title = yDoc.getMap('metadata').get('title') as string || localDoc?.title || '';
            const doc = { ...localDoc, title, content, id };
            setDocument(doc);
            // 初始化临时文档的更新监听（仅本地保存，不加入 WebSocket 房间）
            initTempDocument(id, yDoc, true);
          } catch (error) {
            console.error('临时文档加载失败:', error);
          } finally {
            setLoading(false);
          }
          return;
        }

        // 正式文档：正常加载（包含同步、WebSocket 等）
        try {
          console.log('开始加载正式文档:', id);
          const yDoc = getYDoc(id);
          yDocRef.current = yDoc;

          // 读取本地快照（容错）
          try {
            const localDoc = await localDB.getDoc(id);
            if (localDoc?.yjsSnapshot) {
              try {
                Y.applyUpdate(yDoc, localDoc.yjsSnapshot);
                console.log('localDoc:', localDoc);
                setDocument(localDoc);
              } catch (applyErr) {
                console.error('本地快照损坏，丢弃并重新同步', applyErr);
                await localDB.saveDoc({ ...localDoc, yjsSnapshot: undefined });
              }
            }
          } catch (localError) {
            console.error('本地快照加载失败:', localError);
          }

          // 同步服务器数据
          try {
            await syncDocument(id);
            console.log('syncDocument:同步完成', yDoc);
            const content = yDoc.getText('content').toString();
            const title = yDoc.getMap('metadata').get('title') as string || '';
            console.log('Content after syncDocument:', content);
            console.log('Title after syncDocument:', title);
            setDocument(prev => ({ ...prev, title, content, updatedAt: new Date().toISOString() }));
          } catch (syncError) {
            console.error('服务器同步失败:', syncError);
            const content = yDoc.getText('content').toString();
            const title = yDoc.getMap('metadata').get('title') as string || '';
            if (content || title) setDocument(prev => ({ ...prev, title, content }));
          }

          // 先展示内容，WebSocket 后台连接
          setLoading(false);

          void joinDocRoom(id).then(() => {
            onUpdate(id, (updates: Uint8Array[]) => {
              for (const update of updates) Y.applyUpdate(yDoc, update);
            });
          });

          const handleUpdate = (update: Uint8Array) => {
            localDB.saveUpdate({
              docId: id,
              update,
              clientId: CLIENT_ID,
              timestamp: Date.now(),
              pending: true,
            }).catch(console.error);
            const content = yDoc.getText('content').toString();
            setDocument(prev => ({ ...prev, content, updatedAt: new Date().toISOString() }));
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
        } catch (error) {
          console.error('文档加载失败:', error);
          setLoading(false);
        }
      } else {
        // 新建文档：检测临时草稿，显示 Banner 询问
        const recentTemp = await loadRecentTempDocument();
        if (recentTemp && recentTemp.id) {
          setPendingTempDoc(recentTemp);
          setShowRestoreBanner(true);
        }
        setLoading(false);
      }
    };
    loadDocument();
  }, [id, loadRecentTempDocument, initTempDocument, navigate]);

  // 保存文档
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
        // 新建文档：从Yjs获取最新内容，避免使用过时的React state
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
        
        // 清理临时文档数据，内容已由后端基于createData生成初始快照
        await cleanupTempDocument(currentId);
        
        // 更新React state，确保内容正确显示
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

  // 清理临时文档数据（不迁移内容，因为后端已生成初始快照）
  const cleanupTempDocument = async (tempId: string) => {
    try {
      // 彻底清理临时文档数据
      await localDB.clearPending(tempId);
      await localDB.deleteDoc?.(tempId); // 删除临时文档记录
      syncEngine.clearYDocCache(tempId);
      initializedTempDocs.current.delete(tempId);
      
      console.log(`Cleaned up temp document ${tempId}`);
    } catch (error) {
      console.error('Failed to cleanup temp document:', error);
    }
  };

  // 处理标题变化
  const handleTitleChange = (title: string) => {
    if (id) {
      const yDoc = getYDoc(id);
      yDoc.getMap('metadata').set('title', title);
      setDocument(prev => ({ ...prev, title, updatedAt: new Date().toISOString() }));
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

  // 处理内容变化
  const handleContentChange = (event: { content: string }) => {
    if (id) {
      const yDoc = getYDoc(id);
      const text = yDoc.getText('content');
      text.delete(0, text.length);
      text.insert(0, event.content);
    } else {
      const tempId = document.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const yDoc = getYDoc(tempId);
      initTempDocument(tempId, yDoc);
      const text = yDoc.getText('content');
      text.delete(0, text.length);
      text.insert(0, event.content);
      setDocument(prev => {
        const updated = { ...prev, id: tempId, content: event.content, updatedAt: new Date().toISOString() };
        localDB.saveDoc(updated).catch(console.error);
        return updated;
      });
    }
  };

  // 实时保存到本地存储
  useEffect(() => {
    if (!id && (document.title || document.content)) {
      const tempId = document.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const tempDoc = { ...document, id: tempId, updatedAt: new Date().toISOString() };
      localDB.saveDoc(tempDoc).catch(console.error);
    }
  }, [document.title, document.content, id]);

  const handleImageUpload = async (file: File): Promise<string> => {
    return URL.createObjectURL(file);
  };

  const handleSync = useCallback(async () => {
    if (!id) return;
    setSyncing(true);
    try {
      await syncDocument(id);
    } catch (error) {
      console.error('Sync failed:', error);
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

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="document-edit-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee' }}>
        <button onClick={() => navigate('/notes')} style={{ padding: '8px 16px', backgroundColor: '#f0f0f0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          返回
        </button>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleSync} disabled={syncing} style={{ padding: '8px 16px', backgroundColor: '#f0f0f0', border: 'none', borderRadius: '4px', cursor: syncing ? 'not-allowed' : 'pointer' }}>
            {syncing ? '同步中...' : '同步'}
          </button>
          <button onClick={saveDocument} disabled={saving} style={{ padding: '8px 16px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 恢复草稿提示 Banner */}
      {showRestoreBanner && pendingTempDoc && (
        <div style={{
          backgroundColor: '#fef3c7',
          borderBottom: '1px solid #fde68a',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '14px',
        }}>
          <span>📝 检测到上次未保存的草稿：{pendingTempDoc.title || '无标题'}</span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleRestoreTemp}
              style={{
                padding: '4px 12px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              恢复
            </button>
            <button
              onClick={handleDiscardTemp}
              style={{
                padding: '4px 12px',
                backgroundColor: '#e5e7eb',
                color: '#374151',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              忽略
            </button>
          </div>
        </div>
      )}

      <InkWeaverEditor
        key={document.id}
        content={document.content}
        onChange={handleContentChange}
        title={document.title}
        onTitleChange={handleTitleChange}
        imageUploader={handleImageUpload}
        mobileMode={true}
      />
    </div>
  );
};

export default DocumentEditPage;