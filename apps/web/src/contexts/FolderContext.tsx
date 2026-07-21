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

  const updateFolder = useCallback((folderId: string, updates: Partial<Folder>) => {
    setFolders(prev => prev.map(folder => 
      folder.id === folderId ? { ...folder, ...updates } : folder
    ));
  }, []);

  const removeFolder = useCallback((folderId: string) => {
    setFolders(prev => prev.filter(folder => folder.id !== folderId));
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
