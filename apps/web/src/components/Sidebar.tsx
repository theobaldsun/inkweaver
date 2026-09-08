import { FileText, Search, User, Folder, ChevronRight, Trash2, Plus, Clock, FolderOpen, FolderPlus, Move, Trash } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { useFolders } from '../contexts/FolderContext';
import { documentService, folderApi } from '../services/apiClient';

import type { Folder as FolderType } from '@inkweaver/shared';

interface Document {
  id: string;
  title: string;
  updatedAt: string;
  folderId?: string;
}

interface FolderItem extends FolderType {
  documents?: Document[];
  documentsLoaded?: boolean;
  children?: FolderItem[];
}

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [recentDocs, setRecentDocs] = useState<Document[]>([]);
  const { folders, refreshFolders, loadFolderDocuments } = useFolders();
  const [expandedFolders, setExpandedFolders] = useState<string[]>(['recent', 'my-folders']);
  const [loading, setLoading] = useState(true);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [deleteFolderName, setDeleteFolderName] = useState('');
  const [deleteAllContent, setDeleteAllContent] = useState(true);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDocTitle, setSelectedDocTitle] = useState('');
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string | null>(null);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const response = await documentService.getDocuments(1, 10);
      const docs = response.documents.map(doc => ({
        id: doc.id,
        title: doc.title || '无标题文档',
        updatedAt: doc.updatedAt,
        folderId: doc.folderId ?? undefined
      }));
      setRecentDocs(docs);
    } catch (error) {
      console.error('Failed to load documents:', error);
      setRecentDocs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await folderApi.createFolder({ 
        name: newFolderName.trim(),
        parentId: selectedParentId || undefined 
      });
      setNewFolderName('');
      setShowCreateFolderModal(false);
      setSelectedParentId(null);
      await refreshFolders();
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  };

  const openCreateFolderModal = (parentId: string | null = null) => {
    setSelectedParentId(parentId);
    setNewFolderName('');
    setShowCreateFolderModal(true);
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderId) return;
    try {
      await folderApi.deleteFolder(deleteFolderId, deleteAllContent);
      setShowDeleteModal(false);
      setDeleteFolderId(null);
      setDeleteFolderName('');
      await refreshFolders();
    } catch (error) {
      console.error('Failed to delete folder:', error);
    }
  };

  const openDeleteFolderModal = (folderId: string, folderName: string) => {
    setDeleteFolderId(folderId);
    setDeleteFolderName(folderName);
    setDeleteAllContent(true);
    setShowDeleteModal(true);
  };

  const handleMoveDocument = async () => {
    if (!selectedDocId) return;
    try {
      await documentService.updateDocument(selectedDocId, { folderId: moveTargetFolderId });
      setShowMoveModal(false);
      setSelectedDocId(null);
      setSelectedDocTitle('');
      setMoveTargetFolderId(null);
      await refreshFolders();
      loadDocuments();
    } catch (error) {
      console.error('Failed to move document:', error);
    }
  };

  const openMoveDocumentModal = (docId: string, docTitle: string) => {
    setSelectedDocId(docId);
    setSelectedDocTitle(docTitle);
    setMoveTargetFolderId(null);
    setShowMoveModal(true);
  };

  const toggleFolder = (folderOrId: FolderItem | string) => {
    const folderId = typeof folderOrId === 'string' ? folderOrId : folderOrId.id;
    const willExpand = !expandedFolders.includes(folderId);
    setExpandedFolders(prev => 
      prev.includes(folderId) 
        ? prev.filter(id => id !== folderId)
        : [...prev, folderId]
    );
    if (
      typeof folderOrId !== 'string' &&
      willExpand &&
      (folderOrId.documentCount ?? 0) > 0 &&
      !folderOrId.documentsLoaded
    ) {
      void loadFolderDocuments(folderId);
    }
  };

  const handleDocClick = (docId: string) => {
    navigate(`/documents/${docId}`);
  };

  const handleCreateDoc = () => {
    navigate('/documents/new');
  };

  const isActive = (path: string) => location.pathname === path;

  const renderFolders = (folderList: FolderItem[], depth: number = 0) => {
    return folderList.map(folder => (
      <div key={folder.id} style={{ paddingLeft: depth > 0 ? `${depth * 12}px` : 0 }}>
        <div className="folder-row">
          <button 
            className="folder-header"
            onClick={() => toggleFolder(folder)}
          >
            <ChevronRight 
              size={14} 
              className={`chevron ${expandedFolders.includes(folder.id) ? 'expanded' : ''}`} 
            />
            {expandedFolders.includes(folder.id) ? (
              <FolderOpen size={14} />
            ) : (
              <Folder size={14} />
            )}
            <span className="folder-name">{folder.name}</span>
            <div className="folder-actions">
              <span 
                className="folder-action-btn" 
                onClick={(e) => { e.stopPropagation(); openCreateFolderModal(folder.id); }}
                title="新建子文件夹"
              >
                <FolderPlus size={12} />
              </span>
              <span 
                className="folder-action-btn" 
                onClick={(e) => { e.stopPropagation(); openDeleteFolderModal(folder.id, folder.name); }}
                title="删除文件夹"
              >
                <Trash size={12} />
              </span>
            </div>
          </button>
        </div>
        {expandedFolders.includes(folder.id) && (
          <div className="folder-content">
            {folder.documents && folder.documents.length > 0 && (
              folder.documents.map(doc => (
                <div key={doc.id} className="doc-row">
                  <div 
                    className="doc-item"
                    onClick={() => handleDocClick(doc.id)}
                  >
                    <FileText size={14} />
                    <span className="doc-name">{doc.title}</span>
                  </div>
                  <span 
                    className="doc-action-btn"
                    onClick={() => openMoveDocumentModal(doc.id, doc.title)}
                    title="移动文件"
                  >
                    <Move size={12} />
                  </span>
                </div>
              ))
            )}
            {(folder.documentCount ?? 0) > 0 && !folder.documentsLoaded && (
              <div className="empty-history">正在加载文档…</div>
            )}
            {folder.children && folder.children.length > 0 && (
              renderFolders(folder.children, depth + 1)
            )}
            {(folder.documentCount ?? 0) === 0 && (!folder.children || folder.children.length === 0) && (
              <div className="empty-history">
                <Folder size={16} />
                <div>暂无内容</div>
              </div>
            )}
          </div>
        )}
      </div>
    ));
  };

  const renderMoveOptions = (folderList: FolderItem[], depth = 0): React.ReactNode =>
    folderList.map((folder) => (
      <React.Fragment key={folder.id}>
        <option value={folder.id}>{`${'　'.repeat(depth)}${folder.name}`}</option>
        {folder.children?.length ? renderMoveOptions(folder.children, depth + 1) : null}
      </React.Fragment>
    ));

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <FileText size={20} />
          </div>
          <span>InkWeaver</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button 
          className={`sidebar-nav-item ${isActive('/notes') ? 'active' : ''}`}
          onClick={() => navigate('/notes')}
        >
          <FileText size={18} />
          <span>全部文档</span>
        </button>
        <button 
          className={`sidebar-nav-item ${isActive('/search') ? 'active' : ''}`}
          onClick={() => navigate('/search')}
        >
          <Search size={18} />
          <span>搜索</span>
        </button>
        <button 
          className={`sidebar-nav-item ${isActive('/trash') ? 'active' : ''}`}
          onClick={() => navigate('/trash')}
        >
          <Trash2 size={18} />
          <span>回收站</span>
        </button>
        <button 
          className={`sidebar-nav-item ${isActive('/profile') ? 'active' : ''}`}
          onClick={() => navigate('/profile')}
        >
          <User size={18} />
          <span>个人资料</span>
        </button>
      </nav>

      <div className="sidebar-divider"></div>

      <div className="sidebar-folders">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
          </div>
        ) : (
          <>
            <div className="folder-section">
              <button 
                className="folder-header"
                onClick={() => toggleFolder('recent')}
              >
                <ChevronRight 
                  size={16} 
                  className={`chevron ${expandedFolders.includes('recent') ? 'expanded' : ''}`} 
                />
                <Clock size={16} />
                <span className="folder-name">最近</span>
              </button>
              {expandedFolders.includes('recent') && (
                <div className="folder-content">
                  {recentDocs.length > 0 ? (
                    recentDocs.map(doc => (
                      <div 
                        key={doc.id}
                        className="doc-item"
                        onClick={() => handleDocClick(doc.id)}
                      >
                        <FileText size={14} />
                        <span className="doc-name">{doc.title}</span>
                        <span className="doc-time">{formatDate(doc.updatedAt)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-history">暂无文档</div>
                  )}
                </div>
              )}
            </div>

            <div className="folder-section">
              <button 
                className="folder-header"
                onClick={() => toggleFolder('my-folders')}
              >
                <ChevronRight 
                  size={16} 
                  className={`chevron ${expandedFolders.includes('my-folders') ? 'expanded' : ''}`} 
                />
                <Folder size={16} />
                <span className="folder-name">我的文件夹</span>
                <span className="add-folder-btn" onClick={(e) => { e.stopPropagation(); openCreateFolderModal(null); }}>
                  <FolderPlus size={14} />
                </span>
              </button>
              {expandedFolders.includes('my-folders') && (
                <div className="folder-content">
                  {folders.length > 0 ? (
                    renderFolders(folders)
                  ) : (
                    <div className="empty-history">
                      <Folder size={16} />
                      <div>暂无文件夹</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="btn btn-primary" onClick={handleCreateDoc}>
          <Plus size={18} />
          <span>新建文档</span>
        </button>
        {/* 修复 WEB-P2-11：回收站按钮添加 onClick 导航，原为死按钮 */}
        <button className="recycle-bin-btn" onClick={() => navigate('/trash')}>
          <Trash2 size={16} />
          <span>回收站</span>
        </button>
      </div>

      {showCreateFolderModal && (
        <div className="modal-overlay" onClick={() => setShowCreateFolderModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建文件夹</h3>
              <button className="modal-close" onClick={() => setShowCreateFolderModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <input 
                type="text" 
                className="form-input"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="请输入文件夹名称"
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateFolderModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreateFolder}>确认</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>删除文件夹</h3>
              <button className="modal-close" onClick={() => setShowDeleteModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>确定要删除文件夹「{deleteFolderName}」吗？</p>
              <div className="delete-options">
                <label className="radio-label">
                  <input 
                    type="radio" 
                    name="deleteMode" 
                    checked={deleteAllContent}
                    onChange={() => setDeleteAllContent(true)}
                  />
                  <span>删除文件夹及其所有内容</span>
                </label>
                <label className="radio-label">
                  <input 
                    type="radio" 
                    name="deleteMode" 
                    checked={!deleteAllContent}
                    onChange={() => setDeleteAllContent(false)}
                  />
                  <span>仅删除文件夹，保留内容</span>
                </label>
              </div>
              {!deleteAllContent && (
                <p className="hint">子文件夹将提升为一级文件夹，文件将移至根目录</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>取消</button>
              <button className="btn btn-danger" onClick={handleDeleteFolder}>删除</button>
            </div>
          </div>
        </div>
      )}

      {showMoveModal && (
        <div className="modal-overlay" onClick={() => setShowMoveModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>移动文件</h3>
              <button className="modal-close" onClick={() => setShowMoveModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>将「{selectedDocTitle}」移动到：</p>
              <select 
                className="form-select"
                value={moveTargetFolderId || ''}
                onChange={(e) => setMoveTargetFolderId(e.target.value || null)}
              >
                <option value="">根目录</option>
                {renderMoveOptions(folders)}
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowMoveModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleMoveDocument}>移动</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
