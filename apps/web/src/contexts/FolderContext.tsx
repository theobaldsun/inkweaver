/**
 * 文件夹全局状态管理。
 *
 * 职责：
 * - 维护文件夹树的本地状态（含文档数量统计）
 * - 提供文件夹 CRUD 的本地操作方法
 *
 * 注意：
 * - `updateFolder` / `removeFolder` 已支持递归操作嵌套子文件夹（修复 WEB-P2-10）
 * - `refreshFolders` 从服务端全量拉取最新树
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { folderApi, documentService } from '../services/apiClient';
import type { Folder } from '@inkweaver/shared';

interface DocumentItem {
  id: string;
  title: string;
  updatedAt: string;
  folderId?: string;
}

interface FolderWithDocs extends Folder {
  documents?: DocumentItem[];
  children?: FolderWithDocs[];
}

interface FolderContextType {
  folders: FolderWithDocs[];
  refreshFolders: () => Promise<void>;
  addFolder: (folder: Folder) => void;
  updateFolder: (folderId: string, updates: Partial<Folder>) => void;
  removeFolder: (folderId: string) => void;
}

const FolderContext = createContext<FolderContextType | undefined>(undefined);

export const FolderProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [folders, setFolders] = useState<FolderWithDocs[]>([]);

  const loadFolders = useCallback(async () => {
    try {
      const folderList = await folderApi.getFolderTree();
      const response = await documentService.getDocuments(1, 50);
      const allDocs = response.documents.map(doc => ({
        id: doc.id,
        title: doc.title || '无标题文档',
        updatedAt: doc.updatedAt,
        folderId: doc.folderId
      }));

      const addDocumentsToFolder = (folders: Folder[]): FolderWithDocs[] => {
        return folders.map(folder => {
          const folderWithDocs: FolderWithDocs = {
            ...folder,
            documents: allDocs.filter(doc => doc.folderId === folder.id)
          };
          if (folder.children && folder.children.length > 0) {
            folderWithDocs.children = addDocumentsToFolder(folder.children);
          }
          return folderWithDocs;
        });
      };

      const foldersWithDocs = addDocumentsToFolder(folderList);
      setFolders(foldersWithDocs);
    } catch (error) {
      console.error('Failed to load folders:', error);
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const refreshFolders = useCallback(async () => {
    await loadFolders();
  }, [loadFolders]);

  const addFolder = useCallback((folder: Folder) => {
    setFolders(prev => [...prev, { ...folder, documents: [] }]);
  }, []);

  /**
 * 更新指定文件夹的属性。
 *
 * 递归搜索：在嵌套 children 中查找目标 folderId，确保即使目标是
 * 深层子文件夹也能被正确更新（原实现只处理根层级）。
 *
 * @param folderId 目标文件夹 ID
 * @param updates 要更新的属性（如 { name: '新名称' }）
 */
const updateFolder = useCallback((folderId: string, updates: Partial<Folder>) => {
    // 递归更新：在嵌套 children 中查找并更新目标文件夹
    const updateRecursive = (list: FolderWithDocs[]): FolderWithDocs[] =>
      list.map(folder => {
        if (folder.id === folderId) {
          return { ...folder, ...updates };
        }
        // 注意：只在有 children 时才递归，叶子节点直接返回
        if (folder.children?.length) {
          return { ...folder, children: updateRecursive(folder.children) };
        }
        return folder;
      });
    setFolders(prev => updateRecursive(prev));
  }, []);

  /**
 * 删除指定文件夹（从本地状态中移除）。
 *
 * 递归搜索：先 filter 掉匹配的根层级文件夹，再 map 递归处理 children，
 * 确保深层子文件夹也能被正确移除。
 *
 * @param folderId 要删除的文件夹 ID
 */
const removeFolder = useCallback((folderId: string) => {
    // 递归删除：在嵌套 children 中查找并移除目标文件夹
    const removeRecursive = (list: FolderWithDocs[]): FolderWithDocs[] =>
      list
        .filter(folder => folder.id !== folderId)
        .map(folder => {
          if (folder.children?.length) {
            return { ...folder, children: removeRecursive(folder.children) };
          }
          return folder;
        });
    setFolders(prev => removeRecursive(prev));
  }, []);

  return (
    <FolderContext.Provider value={{
      folders,
      refreshFolders,
      addFolder,
      updateFolder,
      removeFolder,
    }}>
      {children}
    </FolderContext.Provider>
  );
};

export const useFolders = (): FolderContextType => {
  const context = useContext(FolderContext);
  if (!context) {
    throw new Error('useFolders must be used within a FolderProvider');
  }
  return context;
};

export default FolderContext;
