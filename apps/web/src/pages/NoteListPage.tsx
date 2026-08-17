/**
 * 笔记列表页：文件夹导航、筛选、排序与分页。
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FileText, PlusCircle, List, Grid3X3, Trash2, Calendar, Loader2, Folder, Move, ChevronRight, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { documentService } from '../services/apiClient';
import { useFolders } from '../contexts/FolderContext';
import CustomModal, { showAlert } from '../components/CustomModal';
import type { Document, Folder as FolderType } from '@inkweaver/shared';
import { TRASH_RETENTION_DAYS } from '@inkweaver/shared';

type ListFilter = 'all' | 'recent' | 'mine' | 'shared';

const PAGE_SIZE = 20;

interface FolderItem extends FolderType {
  children?: FolderItem[];
}

const NoteListPage: React.FC = () => {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Document[]>([]);
  const { folders, refreshFolders } = useFolders();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [activeFilter, setActiveFilter] = useState<ListFilter>('all');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; noteId: string; noteTitle: string }>({
    isOpen: false,
    noteId: '',
    noteTitle: '',
  });
  const [moveConfirm, setMoveConfirm] = useState<{ isOpen: boolean; noteId: string; noteTitle: string; targetFolderId: string | null }>({
    isOpen: false,
    noteId: '',
    noteTitle: '',
    targetFolderId: null,
  });

  const mapListFilter = (filter: ListFilter): 'all' | 'recent' | 'mine' | 'public' => {
    if (filter === 'shared') return 'public';
    if (filter === 'recent') return 'recent';
    if (filter === 'mine') return 'mine';
    return 'all';
  };

  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError('');
      const apiFilter = mapListFilter(activeFilter);
      const folderId = apiFilter === 'public' ? undefined : currentFolderId;
      const response = await documentService.getDocuments(
        page,
        PAGE_SIZE,
        sortBy,
        sortOrder,
        folderId,
        apiFilter,
      );
      setNotes(response.documents);
      setTotal(response.total);
    } catch (error) {
      console.error('Failed to load notes:', error);
      setNotes([]);
      setTotal(0);
      setLoadError(error instanceof Error ? error.message : '加载文档列表失败');
    } finally {
      setLoading(false);
    }
  }, [activeFilter, sortBy, sortOrder, currentFolderId, page]);

  const filterSig = `${activeFilter}|${sortBy}|${sortOrder}|${currentFolderId ?? ''}`;
  const filterSigRef = useRef(filterSig);

  useEffect(() => {
    if (filterSigRef.current !== filterSig) {
      filterSigRef.current = filterSig;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    void loadNotes();
  }, [filterSig, page, loadNotes]);

  const currentFolderPath = useMemo(() => {
    const path: { id: string | null; name: string }[] = [{ id: null, name: '根目录' }];
    if (!currentFolderId || !folders) return path;

    const findFolderPath = (folderList: FolderItem[], targetId: string): FolderItem | null => {
      for (const folder of folderList) {
        if (folder.id === targetId) return folder;
        if (folder.children) {
          const found = findFolderPath(folder.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    const buildPath = (folder: FolderItem | null, result: { id: string | null; name: string }[] = []): { id: string | null; name: string }[] => {
      if (!folder) return result;
      result.unshift({ id: folder.id, name: folder.name });
      if (folder.parentId && folders) {
        const parent = findFolderPath(folders, folder.parentId);
        return buildPath(parent, result);
      }
      return result;
    };

    const currentFolder = findFolderPath(folders, currentFolderId);
    if (currentFolder) {
      return [...path, ...buildPath(currentFolder)];
    }
    return path;
  }, [currentFolderId, folders]);

  const getCurrentFolderName = useMemo(() => {
    if (!currentFolderId) return '根目录';
    if (!folders) return '根目录';

    const findFolder = (folderList: FolderItem[], targetId: string): FolderItem | null => {
      for (const folder of folderList) {
        if (folder.id === targetId) return folder;
        if (folder.children) {
          const found = findFolder(folder.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    const folder = findFolder(folders, currentFolderId);
    return folder?.name || '根目录';
  }, [currentFolderId, folders]);

  const currentLevelFolders = useMemo(() => {
    if (!folders) return [];

    const getDirectChildren = (folderList: FolderItem[], targetParentId: string | null): FolderItem[] => {
      const result: FolderItem[] = [];
      for (const folder of folderList) {
        if (folder.parentId === targetParentId) {
          result.push(folder);
        }
        if (folder.children) {
          const nestedResult = getDirectChildren(folder.children, targetParentId);
          result.push(...nestedResult);
        }
      }
      return result;
    };

    return getDirectChildren(folders, currentFolderId);
  }, [folders, currentFolderId]);

  const handleNavigateToFolder = (folderId: string) => {
    setCurrentFolderId(folderId);
  };

  const handleNavigateToParent = () => {
    if (!currentFolderId || !folders) {
      setCurrentFolderId(null);
      return;
    }

    const findFolder = (folderList: FolderItem[], targetId: string): FolderItem | null => {
      for (const folder of folderList) {
        if (folder.id === targetId) return folder;
        if (folder.children) {
          const found = findFolder(folder.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    const currentFolder = findFolder(folders, currentFolderId);
    if (currentFolder?.parentId) {
      setCurrentFolderId(currentFolder.parentId);
    } else {
      setCurrentFolderId(null);
    }
  };

  const handleNavigateToRoot = () => {
    setCurrentFolderId(null);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleMoveNote = async (e: React.MouseEvent, note: Document) => {
    e.stopPropagation();
    await refreshFolders();
    setMoveConfirm({
      isOpen: true,
      noteId: note.id,
      noteTitle: note.title,
      targetFolderId: note.folderId || null,
    });
  };

  const confirmMove = async () => {
    try {
      const targetFolderId = moveConfirm.targetFolderId || undefined;
      await documentService.updateDocument(moveConfirm.noteId, { folderId: targetFolderId });
      setNotes(prev => prev.map(note => 
        note.id === moveConfirm.noteId 
          ? { ...note, folderId: targetFolderId }
          : note
      ));
      await refreshFolders();
    } catch (error) {
      // 修复 WEB-P2-07：移动失败时通过 showAlert 通知用户，而非仅 console.error
      console.error('Failed to move note:', error);
      await showAlert('移动失败', error instanceof Error ? error.message : '文档移动失败，请稍后重试', 'error');
    } finally {
      setMoveConfirm({ isOpen: false, noteId: '', noteTitle: '', targetFolderId: null });
    }
  };

  const cancelMove = () => {
    setMoveConfirm({ isOpen: false, noteId: '', noteTitle: '', targetFolderId: null });
  };

  const renderFolderOptions = (folderList: FolderItem[], depth: number = 0): React.ReactNode[] => {
    const options: React.ReactNode[] = [];
    
    folderList.forEach(folder => {
      const prefix = depth > 0 ? '\u00A0\u00A0\u00A0'.repeat(depth) + '└ ' : '';
      options.push(
        <option key={folder.id} value={folder.id}>
          {prefix}{folder.name}
        </option>
      );
      
      if (folder.children && folder.children.length > 0) {
        options.push(...renderFolderOptions(folder.children, depth + 1));
      }
    });
    
    return options;
  };

  const handleSortBy = (field: 'updatedAt' | 'createdAt') => {
    setSortBy(field);
    setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
  };

  const handleCreateNote = () => {
    navigate('/documents/new');
  };

  const handleNoteClick = (noteId: string) => {
    navigate(`/documents/${noteId}`);
  };

  const handleDeleteNote = async (e: React.MouseEvent, note: Document) => {
    e.stopPropagation();
    setDeleteConfirm({
      isOpen: true,
      noteId: note.id,
      noteTitle: note.title,
    });
  };

  const confirmDelete = async () => {
    try {
      await documentService.deleteDocument(deleteConfirm.noteId);
      setNotes(prev => prev.filter(note => note.id !== deleteConfirm.noteId));
    } catch (error) {
      // 修复 WEB-P2-07：删除失败时通过 showAlert 通知用户，而非仅 console.error
      console.error('Failed to delete note:', error);
      await showAlert('删除失败', error instanceof Error ? error.message : '文档删除失败，请稍后重试', 'error');
    } finally {
      setDeleteConfirm({ isOpen: false, noteId: '', noteTitle: '' });
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm({ isOpen: false, noteId: '', noteTitle: '' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return dateString.split('T')[0];
  };

  if (loading) {
    return (
      <div className="notes-page">
        <div className="loading-container">
          <Loader2 className="loading-spinner" />
          <span className="loading-text">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="notes-page">
      <div className="notes-header-wrapper">
        <div className="notes-header">
          <div className="notes-title-section">
            <h1 className="notes-title">全部文档</h1>
          </div>
          
          <div className="notes-actions">
            <button className="btn btn-primary" onClick={handleCreateNote}>
              <PlusCircle size={20} />
              <span>新建文档</span>
            </button>
            
            <button 
              className="btn btn-secondary view-toggle-btn" 
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              title={viewMode === 'grid' ? '列表视图' : '网格视图'}
            >
              {viewMode === 'grid' ? <List size={18} /> : <Grid3X3 size={18} />}
            </button>
          </div>
        </div>

        <div className="notes-toolbar">
          <button 
            className={`toolbar-btn ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            全部
          </button>
          <button 
            className={`toolbar-btn ${activeFilter === 'recent' ? 'active' : ''}`}
            onClick={() => setActiveFilter('recent')}
          >
            最近编辑
          </button>
          <button 
            className={`toolbar-btn ${activeFilter === 'mine' ? 'active' : ''}`}
            onClick={() => setActiveFilter('mine')}
          >
            我创建的
          </button>
          <button 
            className={`toolbar-btn ${activeFilter === 'shared' ? 'active' : ''}`}
            onClick={() => setActiveFilter('shared')}
            title="已设为公开的文档"
          >
            公开文档
          </button>
          
          <div className="sort-divider"></div>
          
          <button 
            className={`toolbar-btn ${sortBy === 'updatedAt' ? 'active' : ''}`}
            onClick={() => handleSortBy('updatedAt')}
          >
            更新时间 {sortBy === 'updatedAt' && (sortOrder === 'ASC' ? '↑' : '↓')}
          </button>
          <button 
            className={`toolbar-btn ${sortBy === 'createdAt' ? 'active' : ''}`}
            onClick={() => handleSortBy('createdAt')}
          >
            创建时间 {sortBy === 'createdAt' && (sortOrder === 'ASC' ? '↑' : '↓')}
          </button>
        </div>
        
        <div className="breadcrumb">
          {currentFolderPath.map((item, index) => (
            <span key={item.id ?? 'root'} className="breadcrumb-item">
              {index > 0 && <ChevronRight size={16} className="breadcrumb-separator" />}
              <button 
                onClick={() => item.id ? handleNavigateToFolder(item.id) : handleNavigateToRoot()}
                className={`breadcrumb-link ${index === currentFolderPath.length - 1 ? 'active' : ''}`}
              >
                {index === 0 ? <Home size={14} className="breadcrumb-home" /> : null}
                <span>{item.name}</span>
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className={`notes-container ${viewMode}`}>
        {currentLevelFolders.map(folder => (
          <div 
            key={folder.id} 
            className="folder-card"
            onClick={() => handleNavigateToFolder(folder.id)}
          >
            <div className="folder-icon-wrapper">
              <Folder size={20} className="folder-icon" />
            </div>
            <div className="folder-info">
              <h3 className="folder-name">{folder.name}</h3>
              <span className="folder-hint">点击进入</span>
            </div>
          </div>
        ))}
        
        {loadError && (
          <div className="empty-state">
            <h3 className="empty-title">加载失败</h3>
            <p className="empty-description">{loadError}</p>
            <button type="button" className="btn btn-secondary" onClick={() => loadNotes()}>
              重试
            </button>
          </div>
        )}
        {!loadError && notes.length === 0 && currentLevelFolders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <FileText size={48} />
            </div>
            <h3 className="empty-title">暂无文档</h3>
            <p className="empty-description">点击上方按钮创建您的第一个文档</p>
            <button className="btn btn-primary empty-action-btn" onClick={handleCreateNote}>
              <PlusCircle size={20} />
              <span>新建文档</span>
            </button>
          </div>
        ) : (
          notes.map(note => (
            <div 
              key={note.id} 
              className="note-card"
              onClick={() => handleNoteClick(note.id)}
            >
              <div className="note-card-header">
                <div className="note-icon-wrapper">
                  <FileText size={20} />
                </div>
                <div className="note-card-actions">
                  <button className="note-action-btn move-btn" onClick={(e) => handleMoveNote(e, note)} title="归档到文件夹">
                    <Move size={16} />
                  </button>
                  <button className="note-action-btn delete-btn" onClick={(e) => handleDeleteNote(e, note)} title="删除">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              
              <h3 className="note-card-title">{note.title}</h3>
              <p className="note-card-content">{note.content.replace(/<[^>]*>/g, '').substring(0, 100)}...</p>
              
              <div className="note-card-footer">
                <div className="note-card-date">
                  <Calendar size={12} />
                  <span>{formatDate(note.updatedAt)}</span>
                </div>
                {note.isPublic && (
                  <div className="note-card-stats">
                    <span className="stat-item">公开</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="notes-pagination">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="pagination-info">
            第 {page} / {totalPages} 页（共 {total} 篇）
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      )}

      <CustomModal
        isOpen={deleteConfirm.isOpen}
        title="确认删除"
        message={`确定要删除文档「${deleteConfirm.noteTitle}」吗？将移入回收站，${TRASH_RETENTION_DAYS} 天后自动永久删除，期间可在回收站中恢复。`}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      <CustomModal
        isOpen={moveConfirm.isOpen}
        title="归档到文件夹"
        message={`将文档「${moveConfirm.noteTitle}」归档到：`}
        onConfirm={confirmMove}
        onCancel={cancelMove}
        showCustomContent
        customContent={
          <select 
            className="form-select"
            value={moveConfirm.targetFolderId || ''}
            onChange={(e) => setMoveConfirm(prev => ({ ...prev, targetFolderId: e.target.value || null }))}
          >
            <option value="">根目录（取消归档）</option>
            {renderFolderOptions(folders)}
          </select>
        }
      />
    </div>
  );
};

export default NoteListPage;