import React from 'react';
import { View, Platform, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface TipTapEditorRNProps {
  content: string;
  onChange: (content: string) => void;
  editable?: boolean;
  height?: number;
}

export const TipTapEditorRN: React.FC<TipTapEditorRNProps> = ({
  content,
}) => {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerText}>富文本编辑器</Text>
        </View>
        <View style={styles.content}>
          <Text style={styles.placeholderText}>
            {content || '富文本内容将在移动端显示'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4a90e2" />
      <Text style={styles.loadingText}>加载编辑器...</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    padding: 16,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  placeholderText: {
    fontSize: 16,
    color: '#64748b',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
});
