import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { documentApi } from '@inkweaver/api';
import type { Document } from '@inkweaver/shared';

export const SearchScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([
    '项目启动',
    '同步引擎',
    '语音转写'
  ]);
  const [searchResults, setSearchResults] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);

  // 从本地存储加载搜索历史
  useEffect(() => {
    // 可以在这里从AsyncStorage加载历史记录
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      // 添加到搜索历史
      setSearchHistory(prev => [searchQuery, ...prev.filter(item => item !== searchQuery)].slice(0, 10));
      
      // 调用API搜索文档
      const result = await documentApi.searchDocuments(searchQuery);
      setSearchResults(result.documents);
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    setSearchHistory([]);
  };

  const handleRemoveHistoryItem = (item: string) => {
    setSearchHistory(prev => prev.filter(i => i !== item));
  };

  const handleSelectHistoryItem = async (item: string) => {
    setSearchQuery(item);
    setLoading(true);
    try {
      const result = await documentApi.searchDocuments(item);
      setSearchResults(result.documents);
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectResult = (docId: string) => {
    (navigation as any).navigate('DocumentEdit', { id: docId });
  };

  const renderHistoryItem = ({ item }: { item: string }) => (
    <TouchableOpacity 
      style={styles.historyItem}
      onPress={() => handleSelectHistoryItem(item)}
    >
      <Text style={styles.historyItemIcon}>📋</Text>
      <Text style={styles.historyItemText}>{item}</Text>
      <TouchableOpacity 
        onPress={() => handleRemoveHistoryItem(item)}
      >
        <Text style={styles.historyItemRemove}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderSearchResult = ({ item }: { item: Document }) => (
    <TouchableOpacity 
      style={styles.searchResultItem}
      onPress={() => handleSelectResult(item.id)}
    >
      <Text style={styles.searchResultTitle}>{item.title || '无标题文档'}</Text>
      <Text style={styles.searchResultContent} numberOfLines={2}>
        {item.content ? item.content.substring(0, 100) + (item.content.length > 100 ? '...' : '') : '空文档'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 搜索输入框 */}
      <View style={styles.searchInputContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="搜索笔记..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        {searchQuery && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 搜索历史 */}
      {!searchQuery && (
        <View style={styles.searchHistory}>
          <View style={styles.searchHistoryTitle}>
            <Text style={styles.searchHistoryTitleText}>搜索历史</Text>
            {searchHistory.length > 0 && (
              <TouchableOpacity onPress={handleClearHistory}>
                <Text style={styles.clearHistoryText}>清空</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {searchHistory.length > 0 ? (
            <FlatList
              data={searchHistory}
              renderItem={renderHistoryItem}
              keyExtractor={(item, index) => index.toString()}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View style={styles.emptyHistory}>
              <Text style={styles.emptyHistoryText}>暂无搜索历史</Text>
              <Text style={styles.emptyHistorySubtext}>输入关键词开始搜索</Text>
            </View>
          )}
        </View>
      )}

      {/* 搜索结果 */}
      {searchQuery && (
        <View style={styles.searchResults}>
          <Text style={styles.searchResultsTitle}>搜索结果</Text>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#4a90e2" />
            </View>
          ) : searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              renderItem={renderSearchResult}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View style={styles.emptyResults}>
              <Text style={styles.emptyResultsText}>未找到相关笔记</Text>
              <Text style={styles.emptyResultsSubtext}>尝试其他关键词</Text>
            </View>
          )}
        </View>
      )}

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
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  searchIcon: {
    fontSize: 16,
    color: '#999',
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  searchClear: {
    fontSize: 18,
    color: '#94a3b8',
    marginLeft: 8,
    padding: 4,
    backgroundColor: 'transparent',
  },
  searchHistory: {
    flex: 1,
    paddingHorizontal: 16,
  },
  searchHistoryTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchHistoryTitleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  clearHistoryText: {
    fontSize: 12,
    color: '#999',
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'white',
    borderRadius: 8,
    marginBottom: 8,
  },
  historyItemIcon: {
    fontSize: 14,
    color: '#999',
    marginRight: 12,
  },
  historyItemText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  historyItemRemove: {
    fontSize: 14,
    color: '#94a3b8',
    padding: 8,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
  },
  emptyHistory: {
    alignItems: 'center',
    padding: 48,
  },
  emptyHistoryText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  emptyHistorySubtext: {
    fontSize: 14,
    color: '#999',
  },
  searchResults: {
    flex: 1,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  searchResultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 24,
  },
  searchResultItem: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  searchResultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  searchResultContent: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  emptyResults: {
    alignItems: 'center',
    padding: 48,
  },
  emptyResultsText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  emptyResultsSubtext: {
    fontSize: 14,
    color: '#999',
  },
});
