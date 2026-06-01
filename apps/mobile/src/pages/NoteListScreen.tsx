import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert, TextInput, Modal, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { documentApi, folderApi } from '@inkweaver/api';
import { authService } from '../services/authService';
import type { Document, Folder as FolderType } from '@inkweaver/shared';

interface FolderItem extends FolderType {
  documents?: Document[];
}

export const NoteListScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const loadDocuments = async () => {
    try {
      const result = await documentApi.getDocuments(1, 50, sortBy, sortOrder);
      setDocuments(result.documents.filter(doc => !doc.folderId));
    } catch (error) {
      console.error('加载文档列表失败:', error);
      const mockDocs = [
        { id: '1', title: '测试文档 1', content: '这是一个测试文档', createdAt: '2024-05-22T10:30:00Z', updatedAt: '2024-05-22T10:30:00Z', userId: '1' },
        { id: '2', title: '测试文档 2', content: '这是另一个测试文档', createdAt: '2024-05-21T14:00:00Z', updatedAt: '2024-05-21T14:00:00Z', userId: '1' },
      ];
      const sortedDocs = [...mockDocs].sort((a, b) => {
        const aDate = new Date(a[sortBy]);
        const bDate = new Date(b[sortBy]);
        return sortOrder === 'ASC' ? aDate.getTime() - bDate.getTime() : bDate.getTime() - aDate.getTime();
      });
      setDocuments(sortedDocs);
    }
  };

  const loadFolders = async () => {
    try {
      const folderList = await folderApi.getFolderTree();
      const response = await documentApi.getDocuments(1, 50);
      const allDocs = response.documents;

      const foldersWithDocs = folderList.map(folder => ({
        ...folder,
        documents: allDocs.filter(doc => doc.folderId === folder.id)
      }));
      setFolders(foldersWithDocs);
    } catch (error) {
      console.error('加载文件夹失败:', error);
      setFolders([
        { id: 'folder-1', name: '我的文件夹', userId: '1', createdAt: '2024-05-01', updatedAt: '2024-05-20', documents: [
          { id: '3', title: '项目计划', content: '项目计划内容...', createdAt: '2024-05-20T09:00:00Z', updatedAt: '2024-05-20T09:00:00Z', userId: '1' },
        ]}
      ]);
    }
  };

  useEffect(() => {
    loadDocuments();
    loadFolders();
  }, [sortBy, sortOrder]);

  // 下拉刷新
  const handleRefresh = () => {
    setRefreshing(true);
    loadDocuments();
  };

  const handleCreateNote = () => {
    (navigation as any).navigate('DocumentEdit', {});
  };

  const handleVoiceNote = () => {
    Alert.alert('功能开发中', '语音速记功能即将推出');
  };

  const handleImport = () => {
    Alert.alert('功能开发中', '导入功能即将推出');
  };

  const handleEditNote = (id: string) => {
    (navigation as any).navigate('DocumentEdit', { id });
  };

  const handleViewAll = () => {
    // 暂时不做特殊处理，显示所有文档
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return '今天';
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  };

  const renderNoteItem = ({ item }: { item: Document }) => (
    <TouchableOpacity style={styles.noteCard} onPress={() => handleEditNote(item.id)}>
      <View style={styles.noteHeader}>
        <Text style={styles.noteTitle}>{item.title || '无标题文档'}</Text>
        <TouchableOpacity 
          style={styles.noteAction} 
          onPress={() => handleEditNote(item.id)}
        >
          <Text>✏️</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.noteContent} numberOfLines={2}>
        {item.content ? item.content.substring(0, 100) + (item.content.length > 100 ? '...' : '') : '空文档'}
      </Text>
      <View style={styles.noteMeta}>
        <View style={styles.noteDate}>
          <Text style={styles.noteMetaText}>📅 {formatDate(item.updatedAt)}</Text>
        </View>
        <View style={styles.noteStats}>
          <Text style={styles.noteMetaText}>🔄 已同步</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" style={styles.loading} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 顶部栏 */}
      <View style={styles.topBar}>
        <View style={styles.logo}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoIconText}>I</Text>
          </View>
          <Text style={styles.logoText}>InkWeaver</Text>
        </View>
        <TouchableOpacity 
          style={styles.syncStatus}
          onPress={handleRefresh}
        >
          <Text style={styles.syncStatusText}>🔄 刷新</Text>
        </TouchableOpacity>
      </View>

      {/* 操作按钮组 */
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('DocumentEdit', {})}>
          <Text style={styles.actionButtonIcon}>📝</Text>
          <Text style={styles.actionButtonText}>新建笔记</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleVoiceNote}>
          <Text style={styles.actionButtonIcon}>🎤</Text>
          <Text style={styles.actionButtonText}>语音速记</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleImport}>
          <Text style={styles.actionButtonIcon}>📁</Text>
          <Text style={styles.actionButtonText}>导入</Text>
        </TouchableOpacity>
      </View>

      {/* 排序栏 */}
      <View style={styles.sortBar}>
        <TouchableOpacity 
          style={[styles.sortButton, sortBy === 'updatedAt' && styles.sortButtonActive]}
          onPress={() => setSortBy('updatedAt')}
        >
          <Text style={styles.sortButtonText}>更新时间 {sortBy === 'updatedAt' && (sortOrder === 'ASC' ? '↑' : '↓')}</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.sortButton, sortBy === 'createdAt' && styles.sortButtonActive]}
          onPress={() => setSortBy('createdAt')}
        >
          <Text style={styles.sortButtonText}>创建时间 {sortBy === 'createdAt' && (sortOrder === 'ASC' ? '↑' : '↓')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sortButton} onPress={() => setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC')}>
          <Text style={styles.sortButtonText}>{sortOrder === 'ASC' ? '正序' : '逆序'}</Text>
        </TouchableOpacity>
      </View>

      {/* 文件夹列表 */}
      {folders.length > 0 && (
        <View style={styles.foldersSection}>
          <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>文件夹</Text>
            <TouchableOpacity style={styles.addFolderButton} onPress={() => setShowCreateFolderModal(true)}>
              <Text style={styles.addFolderText}>📁 新建</Text>
            </TouchableOpacity>
          </View>
          
          {folders.map(folder => (
            <View key={folder.id} style={styles.folderItem}>
              <TouchableOpacity 
                style={styles.folderHeader}
                onPress={() => setExpandedFolders(prev => prev.includes(folder.id) ? prev.filter(id => id !== folder.id) : [...prev, folder.id])}
              >
                <Text style={styles.folderIcon}>{expandedFolders.includes(folder.id) ? '▼' : '▶'}</Text>
                <Text style={styles.folderName}>📁 {folder.name}</Text>
                <Text style={styles.folderCount}>{folder.documents?.length || 0}</Text>
              </TouchableOpacity>
              
              {expandedFolders.includes(folder.id) && folder.documents && folder.documents.length > 0 && (
                <View style={styles.folderContents}>
                  {folder.documents.map(doc => (
                    <TouchableOpacity 
                      key={doc.id} 
                      style={styles.folderNoteCard}
                      onPress={() => navigation.navigate('DocumentEdit', { id: doc.id })}
                    >
                      <Text style={styles.folderNoteTitle}>{doc.title || '无标题'}</Text>
                      <Text style={styles.folderNoteDate}>{formatDate(doc.updatedAt)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* 最近笔记 */}
      <View style={styles.recentNotes}>
        <View style={styles.sectionTitle}>
          <Text style={styles.sectionTitleText}>最近笔记</Text>
          <TouchableOpacity onPress={handleViewAll}>
            <Text style={styles.viewAllText}>全部</Text>
          </TouchableOpacity>
        </View>
        
        <FlatList
          data={documents}
          renderItem={renderNoteItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>暂无文档</Text>
              <Text style={styles.emptyStateSubtext}>点击"新建笔记"开始记录</Text>
            </View>
          }
        />
      </View>

      {/* 新建文件夹弹窗 */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateFolderModal}
        onRequestClose={() => setShowCreateFolderModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>新建文件夹</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="请输入文件夹名称"
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancelButton}
                onPress={() => setShowCreateFolderModal(false)}
              >
                <Text style={styles.modalButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalConfirmButton}
                onPress={async () => {
                  if (!newFolderName.trim()) {
                    Alert.alert('提示', '请输入文件夹名称');
                    return;
                  }
                  try {
                    await folderApi.createFolder({ name: newFolderName.trim() });
                    setNewFolderName('');
                    setShowCreateFolderModal(false);
                    loadFolders();
                    Alert.alert('成功', '文件夹创建成功');
                  } catch (error) {
                    Alert.alert('错误', '创建文件夹失败');
                  }
                }}
              >
                <Text style={styles.modalButtonText}>确认</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 120,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginBottom: 24,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#4a90e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIconText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  logoText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  syncStatusText: {
    fontSize: 14,
    color: '#666',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonIcon: {
    fontSize: 16,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  recentNotes: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitleText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  viewAllText: {
    fontSize: 14,
    color: '#4a90e2',
  },
  noteCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  noteAction: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteContent: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 12,
  },
  noteMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noteDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  noteStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noteMetaText: {
    fontSize: 12,
    color: '#999',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    color: '#666',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
  },
  sortBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  sortButtonActive: {
    backgroundColor: '#4a90e2',
  },
  sortButtonText: {
    fontSize: 12,
    color: '#666',
  },
  foldersSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  addFolderButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  addFolderText: {
    fontSize: 12,
    color: '#4a90e2',
  },
  folderItem: {
    marginBottom: 8,
  },
  folderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    backgroundColor: 'white',
    borderRadius: 8,
  },
  folderIcon: {
    fontSize: 12,
    color: '#666',
  },
  folderName: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  folderCount: {
    fontSize: 12,
    color: '#999',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  folderContents: {
    paddingLeft: 24,
    marginTop: 4,
  },
  folderNoteCard: {
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    marginBottom: 4,
  },
  folderNoteTitle: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  folderNoteDate: {
    fontSize: 12,
    color: '#999',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  modalConfirmButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#4a90e2',
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
});
