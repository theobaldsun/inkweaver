/**
 * 存储用量展示面板（React Native）。
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { formatStorageSize } from '@inkweaver/shared';
import { useStorageUsage } from '../hooks/useStorageUsage';

export interface StorageUsagePanelProps {
  compact?: boolean;
  pollIntervalMs?: number;
}

export const StorageUsagePanel: React.FC<StorageUsagePanelProps> = ({
  compact = false,
  pollIntervalMs = 60_000,
}) => {
  const { usage, loading, error, refresh } = useStorageUsage({ pollIntervalMs });

  const usedBytes = usage?.usedBytes ?? 0;
  const quotaBytes = usage?.quotaBytes ?? 0;
  const percent = usage?.usagePercent ?? 0;
  const barColor = percent >= 90 ? '#ef4444' : percent >= 70 ? '#f59e0b' : '#3b82f6';

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>存储空间</Text>
        <TouchableOpacity
          onPress={() => void refresh(true)}
          disabled={loading}
          style={styles.refreshBtn}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#3b82f6" />
          ) : (
            <Text style={styles.refreshText}>刷新</Text>
          )}
        </TouchableOpacity>
      </View>

      {error ? (
        <Text style={styles.error}>
          {error}
          {usage?.stale ? '（缓存）' : ''}
        </Text>
      ) : null}

      <Text style={styles.formatted}>{formatStorageSize(usedBytes)}</Text>
      <Text style={styles.quota}>/ {formatStorageSize(quotaBytes)}</Text>
      <Text style={styles.bytes}>
        {usedBytes.toLocaleString()} / {quotaBytes.toLocaleString()} 字节
      </Text>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.min(100, percent)}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={styles.percent}>{percent}% 已使用</Text>

      {!compact && usage ? (
        <View style={styles.breakdown}>
          <Text style={styles.row}>文档 {formatStorageSize(usage.documentDataBytes)}</Text>
          <Text style={styles.row}>同步 {formatStorageSize(usage.syncDataBytes)}</Text>
          <Text style={styles.row}>笔记 {usage.documentCount} · 文件夹 {usage.folderCount}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  refreshBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  refreshText: { fontSize: 13, color: '#3b82f6' },
  error: { color: '#dc2626', fontSize: 13, marginBottom: 8 },
  formatted: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  quota: { fontSize: 14, color: '#64748b', marginTop: 2 },
  bytes: { fontSize: 12, color: '#94a3b8', marginVertical: 8 },
  barTrack: {
    height: 10,
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 999 },
  percent: { fontSize: 12, color: '#64748b', marginTop: 6 },
  breakdown: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  row: { fontSize: 13, color: '#475569', paddingVertical: 2 },
});
