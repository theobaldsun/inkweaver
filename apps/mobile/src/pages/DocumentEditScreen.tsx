/**
 * 文档编辑页面 - 基于H5 DocumentEditPage适配移动端
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, 
  StyleSheet, KeyboardAvoidingView, Platform, Alert 
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { documentApi } from '@inkweaver/api';

import { Document, CreateDocumentRequest, UpdateDocumentRequest } from '@inkweaver/shared';
import { TipTapEditorRN } from '../components/TipTapEditorRN';
import { syncService } from '../services/syncService';
import type { RootStackParamList } from '../App';

type DocumentEditScreenRouteProp = RouteProp<RootStackParamList, 'DocumentEdit'>;

const DocumentEditScreen: React.FC = () => {
  const route = useRoute<DocumentEditScreenRouteProp>();
  const navigation = useNavigation();
  const id = route.params?.id;
  
  const [document, setDocument] = useState<Document>({
    id: '',
    title: '',
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: 'test-user-id',
    lastUpdateId: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [content, setContent] = useState<string>('');
  const [isNewDocument, setIsNewDocument] = useState<boolean>(!id);
  
  const tempIdRef = useRef<string>('');
  const initializedTempDocs = useRef<Set<string>>(new Set());

  const generateTempId = () => {
    return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  useEffect(() => {
    const loadDocument = async () => {
      try {
        if (id) {
          const doc = await documentApi.getDocument(id);
          setDocument(doc);
          setContent(doc.content);
        } else {
          const tempId = generateTempId();
          tempIdRef.current = tempId;
          setIsNewDocument(true);
          setDocument(prev => ({ ...prev, title: '无标题文档' }));
          setContent('');
        }
      } catch (error) {
        console.error('加载文档失败:', error);
        Alert.alert('错误', '加载文档失败');
      } finally {
        setLoading(false);
      }
    };

    loadDocument();
  }, [id]);

  const saveDocument = async () => {
    setSaving(true);
    try {
      if (id) {
        const updateData: UpdateDocumentRequest = {
          title: document.title,
          content: content,
        };
        await documentApi.updateDocument(id, updateData);
        
        await syncService.syncDocument(id);
        
        Alert.alert('成功', '文档保存并同步完成');
      } else {
        const createData: CreateDocumentRequest = {
          title: document.title || '无标题文档',
          content: content,
        };
        const response = await documentApi.createDocument(createData);
        
        // @ts-ignore
        navigation.navigate('DocumentEdit', { id: response.id });
        
        Alert.alert('成功', '文档创建完成');
      }
    } catch (error) {
      console.error('保存文档失败:', error);
      Alert.alert('错误', '保存文档失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleTitleChange = (text: string) => {
    setDocument(prev => ({
      ...prev,
      title: text,
    }));
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
  };

  const handleBack = () => {
    navigation.goBack();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4a90e2" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>← 返回</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.titleInput}
          value={document.title}
          onChangeText={handleTitleChange}
          placeholder="无标题文档"
          placeholderTextColor="#999"
        />
        <TouchableOpacity 
          style={[styles.saveButton, saving && styles.saveButtonDisabled]} 
          onPress={saveDocument} 
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text style={styles.saveButtonText}>保存</Text>
          )}
        </TouchableOpacity>
      </View>
      <View style={styles.editorContainer}>
        <TipTapEditorRN
          content={content}
          onChange={handleContentChange}
          height={600}
        />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 14,
    color: '#4a90e2',
  },
  titleInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginHorizontal: 12,
    paddingVertical: 8,
  },
  saveButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#4a90e2',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#a0c4f1',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  editorContainer: {
    flex: 1,
    backgroundColor: 'white',
  },
});

export default DocumentEditScreen;
