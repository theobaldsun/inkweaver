import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { documentService, documentApi, folderApi } from '../services/apiClient';
import { syncDocument } from '../services/syncService';
import { FileText, PlusCircle, Mic, FolderOpen, Edit2, Trash2, Calendar, MessageCircle, Search, User, RefreshCw, Folder, ChevronDown, ChevronUp, FolderPlus } from 'lucide-react';
import { showAlert, showConfirm } from '../components/CustomModal';

import type { Document, Folder as FolderType } from '@inkweaver/shared';

const stripHtmlTags = (html: string): string => {
  if (!html) return '';
  const stripped = html.replace(/<[^>]*>/g, '');
  const cleaned = stripped.replace(/\s+/g, ' ').trim();
  return cleaned.length > 100 ? cleaned.substring(0, 100) + '...' : cleaned;
};

interface FolderItem extends FolderType {
  documents?: Document[];
}

export const NoteListPage: React.FC = () => {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Document[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void loadDocuments();
    void loadFolders();
  }, [sortBy, sortOrder]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const response = await documentService.getDocuments(1, 50, sortBy, sortOrder);
      setNotes(response.documents.filter((doc) => !doc.folderId));
    } catch (error) {
      console.error('Failed to load documents:', error);
      setNotes([]);
      setLoadError(error instanceof Error ? error.message : '加载文档失败');
    } finally {
      setLoading(false);
    }
  };

  const loadFolders = async () => {
    try {
      const folderList = await folderApi.getFolderTree();
      const response = await documentService.getDocuments(1, 100, sortBy, sortOrder);
      const allDocs = response.documents;
      const foldersWithDocs = folderList.map((folder) => ({
        ...folder,
        documents: allDocs.filter((doc) => doc.folderId === folder.id),
      }));
      setFolders(foldersWithDocs);
    } catch (error) {
      console.error('Failed to load folders:', error);
      setFolders([]);
    }
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => 
      prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]
    );
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      showAlert('提示', '请输入文件夹名称', 'info');
      return;
    }
    try {
      await folderApi.createFolder({ name: newFolderName.trim() });
      setNewFolderName('');
      setShowCreateFolderModal(false);
      loadFolders();
      showAlert('成功', '文件夹创建成功', 'success');
    } catch (error) {
      console.error('Failed to create folder:', error);
      showAlert('错误', '创建文件夹失败', 'error');
    }
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
  };

  const handleCreateNote = () => {
    navigate('/documents/new');
  };

  const handleVoiceNote = () => {
    console.log('语音记笔记');
  };

  const handleImport = () => {
    console.log('导入笔记');
  };

  const handleEditNote = (id: string) => {
    navigate(`/documents/${id}`);
  };

  const handleDeleteNote = async (id: string) => {
    showConfirm('确认删除', '确定要删除这个笔记吗？', async () => {
      try {
        await documentApi.deleteDocument(id);
        setNotes(notes.filter(note => note.id !== id));
      } catch (error) {
        console.error('Failed to delete document:', error);
        showAlert('错误', '删除笔记失败，请重试', 'error');
      }
    });
  };

  const handleViewAll = () => {
    console.log('查看全部笔记');
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      for (const note of notes) {
        await syncDocument(note.id);
      }
      const response = await documentApi.getDocuments();
      setNotes(response.documents);
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <div className="loading-text">加载中...</div>
      </div>
    );
  }

  return (
    <div className="main-content note-list-page">
      <div className="top-bar">
        <div className="logo">
          <div className="logo-icon">
            <FileText size={20} strokeWidth={2.5} />
          </div>
          <span className="logo-text">InkWeaver</span>
        </div>
        <div className="sync-status" onClick={handleSync} style={{ cursor: 'pointer' }}>
          <RefreshCw size={14} className={syncing ? 'spin' : ''} />
          <span>{syncing ? '同步中...' : '已同步'}</span>
        </div>
      </div>

      <div className="action-buttons">
        <div className="action-button" onClick={handleCreateNote}>
          <PlusCircle size={20} />
          <span>新建</span>
        </div>
        <div className="action-button" onClick={handleVoiceNote}>
          <Mic size={20} />
          <span>语音</span>
        </div>
        <div className="action-button" onClick={handleImport}>
          <FolderOpen size={20} />
          <span>导入</span>
        </div>
      </div>

      <div className="sort-bar">
        <button 
          className={`sort-btn ${sortBy === 'updatedAt' ? 'active' : ''}`}
          onClick={() => setSortBy('updatedAt')}
        >
          更新时间 {sortBy === 'updatedAt' && (sortOrder === 'ASC' ? '↑' : '↓')}
        </button>
        <button 
          className={`sort-btn ${sortBy === 'createdAt' ? 'active' : ''}`}
          onClick={() => setSortBy('createdAt')}
        >
          创建时间 {sortBy === 'createdAt' && (sortOrder === 'ASC' ? '↑' : '↓')}
        </button>
        <button className="sort-btn" onClick={toggleSortOrder}>
          {sortOrder === 'ASC' ? '正序' : '逆序'}
        </button>
      </div>

      {folders.length > 0 && (
        <div className="folders-section">
          <div className="section-title">
            <h2>文件夹</h2>
            <button className="add-folder-btn" onClick={() => setShowCreateFolderModal(true)}>
              <FolderPlus size={14} />
              <span>新建</span>
            </button>
          </div>
          
          <div className="folder-list">
            {folders.map(folder => (
              <div key={folder.id} className="folder-item">
                <button 
                  className="folder-header"
                  onClick={() => toggleFolder(folder.id)}
                >
                  {expandedFolders.includes(folder.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <Folder size={14} />
                  <span className="folder-name">{folder.name}</span>
                  <span className="folder-count">{folder.documents?.length || 0}</span>
                </button>
                {expandedFolders.includes(folder.id) && folder.documents && folder.documents.length > 0 && (
                  <div className="folder-contents">
                    {folder.documents.map(doc => (
                      <div 
                        key={doc.id} 
                        className="note-card folder-note"
                        onClick={() => navigate(`/documents/${doc.id}`)}
                      >
                        <div className="note-header">
                          <h3 className="note-title">{doc.title || '无标题'}</h3>
                        </div>
                        <div className="note-content">{stripHtmlTags(doc.content) || '无内容'}</div>
                        <div className="note-meta">
                          <div className="note-date">
                            <Calendar size={12} />
                            <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="recent-notes">
        <div className="section-title">
          <h2>最近笔记</h2>
          <span className="view-all" onClick={handleViewAll}>全部</span>
        </div>
        
        <div className="note-list">
          {notes.map((note) => (
            <div key={note.id} className="note-card">
              <div className="note-header">
                <h3 className="note-title">{note.title || '无标题'}</h3>
                <div className="note-actions">
                  <div 
                    className="note-action" 
                    onClick={() => handleEditNote(note.id)}
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </div>
                  <div 
                    className="note-action" 
                    onClick={() => handleDeleteNote(note.id)}
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </div>
                </div>
              </div>
              <div className="note-content">
                {stripHtmlTags(note.content) || '无内容'}
              </div>
              <div className="note-meta">
                <div className="note-date">
                  <Calendar size={12} />
                  <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="note-stats">
                  <div className="note-stat">
                    <MessageCircle size={12} />
                    <span>0</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreateFolderModal && (
        <div className="modal-overlay" onClick={() => setShowCreateFolderModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>新建文件夹</h3>
            <input 
              type="text" 
              className="modal-input"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="请输入文件夹名称"
              autoFocus
            />
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowCreateFolderModal(false)}>取消</button>
              <button className="modal-btn confirm" onClick={handleCreateFolder}>确认</button>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-nav">
        <Link to="/notes" className="nav-item active">
          <FileText className="nav-icon" size={22} />
          <div className="nav-label">笔记</div>
        </Link>
        <Link to="/search" className="nav-item">
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
