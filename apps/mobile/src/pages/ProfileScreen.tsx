import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { authService, userService } from '@inkweaver/services';
import { StorageUsagePanel } from '@inkweaver/ui';
import { formatStorageSize } from '@inkweaver/shared';
import { User, Settings, Shield, Bell, HardDrive, Info, MessageSquare, LogOut, X } from 'lucide-react-native';
import type { User as UserType } from '@inkweaver/shared';

export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [user, setUser] = useState<UserType | null>(null);
  const [storageStats, setStorageStats] = useState<{ documentCount: number; usedStorage: number; totalStorage: number } | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    loadUserInfo();
    loadStorageStats();
  }, []);

  const loadUserInfo = async () => {
    try {
      const profile = await userService.getProfile();
      setUser(profile);
      setEditForm({ name: profile.name || '', email: profile.email || '' });
    } catch (error) {
      console.error('加载用户信息失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStorageStats = async () => {
    try {
      const usage = await userService.getStorageUsage();
      setStorageStats({
        documentCount: usage.documentCount,
        usedStorage: usage.usedBytes,
        totalStorage: usage.quotaBytes,
      });
    } catch (error) {
      console.error('加载存储统计失败:', error);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      '确认退出',
      '确定要退出登录吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出',
          onPress: async () => {
            try {
              await authService.logout();
              navigation.navigate('Auth');
            } catch (error) {
              Alert.alert('错误', '退出登录失败');
            }
          },
        },
      ],
      { cancelable: false }
    );
  };

  const handleSaveProfile = async () => {
    try {
      setError('');
      if (!editForm.name.trim()) {
        setError('请输入用户名');
        return;
      }
      
      const updatedUser = await userService.updateProfile({
        name: editForm.name,
      });
      
      setUser(updatedUser);
      setShowEditModal(false);
      Alert.alert('成功', '个人信息更新成功');
    } catch (error) {
      setError(error instanceof Error ? error.message : '更新失败');
    }
  };

  const handleChangePassword = async () => {
    try {
      setError('');
      
      if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
        setError('请填写所有字段');
        return;
      }
      
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
      
      if (passwordForm.newPassword.length < 8) {
        setError('密码长度至少8位');
        return;
      }
      
      await userService.changePassword({
        oldPassword: passwordForm.oldPassword,
        newPassword: passwordForm.newPassword,
      });
      
      setShowPasswordModal(false);
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      Alert.alert('成功', '密码修改成功');
    } catch (error) {
      setError(error instanceof Error ? error.message : '修改失败');
    }
  };

  const displayName = user?.name || '用户名称';
  const displayEmail = user?.email || '';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <View style={styles.loadingSpinner} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      ) : (
        <>
          <View style={styles.profileHeader}>
            <View style={styles.profileAvatar}>
              <User size={40} color="#ffffff" />
            </View>
            <Text style={styles.profileName}>{displayName}</Text>
            {displayEmail && <Text style={styles.profileEmail}>{displayEmail}</Text>}
          </View>

          <View style={styles.profileSection}>
            <View style={styles.profileSectionHeader}>
              <Settings size={16} color="#64748b" />
              <Text style={styles.profileSectionTitle}>账户设置</Text>
            </View>
            <View style={styles.profileSectionContent}>
              <TouchableOpacity 
                style={styles.profileItem}
                onPress={() => setShowEditModal(true)}
                activeOpacity={0.8}
              >
                <View style={styles.profileItemLabel}>
                  <User size={18} color="#64748b" />
                  <Text style={styles.profileItemLabelText}>个人信息</Text>
                </View>
                <View style={styles.profileItemValueContainer}>
                  <Text style={styles.profileItemValueText}>{displayName}</Text>
                  <Text style={styles.profileItemArrow}>›</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.profileItem}
                onPress={() => setShowPasswordModal(true)}
                activeOpacity={0.8}
              >
                <View style={styles.profileItemLabel}>
                  <Shield size={18} color="#64748b" />
                  <Text style={styles.profileItemLabelText}>密码设置</Text>
                </View>
                <View style={styles.profileItemValueContainer}>
                  <Text style={styles.profileItemValueText}>*******</Text>
                  <Text style={styles.profileItemArrow}>›</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.profileItem}
                onPress={() => handleProfileItem('通知设置')}
                activeOpacity={0.8}
              >
                <View style={styles.profileItemLabel}>
                  <Bell size={18} color="#64748b" />
                  <Text style={styles.profileItemLabelText}>通知设置</Text>
                </View>
                <Text style={styles.profileItemArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.profileSection}>
            <View style={styles.profileSectionHeader}>
              <HardDrive size={16} color="#64748b" />
              <Text style={styles.profileSectionTitle}>存储空间</Text>
            </View>
            <StorageUsagePanel pollIntervalMs={60_000} />
          </View>

          <View style={styles.profileSection}>
            <View style={styles.profileSectionHeader}>
              <Info size={16} color="#64748b" />
              <Text style={styles.profileSectionTitle}>其他设置</Text>
            </View>
            <View style={styles.profileSectionContent}>
              <View style={styles.profileItem}>
                <View style={styles.profileItemLabel}>
                  <HardDrive size={18} color="#64748b" />
                  <Text style={styles.profileItemLabelText}>存储摘要</Text>
                </View>
                <Text style={styles.profileItemValueText}>
                  {storageStats
                    ? `${formatStorageSize(storageStats.usedStorage)} / ${formatStorageSize(storageStats.totalStorage)}`
                    : '加载中…'}
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.profileItem}
                onPress={() => handleProfileItem('关于我们')}
                activeOpacity={0.8}
              >
                <View style={styles.profileItemLabel}>
                  <Info size={18} color="#64748b" />
                  <Text style={styles.profileItemLabelText}>关于我们</Text>
                </View>
                <View style={styles.profileItemValueContainer}>
                  <Text style={styles.profileItemValueText}>v1.0.0</Text>
                  <Text style={styles.profileItemArrow}>›</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.profileItemLast}
                onPress={() => handleProfileItem('意见反馈')}
                activeOpacity={0.8}
              >
                <View style={styles.profileItemLabel}>
                  <MessageSquare size={18} color="#64748b" />
                  <Text style={styles.profileItemLabelText}>意见反馈</Text>
                </View>
                <Text style={styles.profileItemArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity 
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <LogOut size={18} color="#ef4444" />
            <Text style={styles.logoutButtonText}>退出登录</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>编辑个人信息</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)} activeOpacity={0.5}>
                <X size={28} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>用户名</Text>
                <TextInput
                  style={styles.formInput}
                  value={editForm.name}
                  onChangeText={(text) => setEditForm({ ...editForm, name: text })}
                  placeholder="请输入用户名"
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>邮箱</Text>
                <TextInput
                  style={styles.formInput}
                  value={editForm.email}
                  onChangeText={(text) => setEditForm({ ...editForm, email: text })}
                  placeholder="请输入邮箱"
                  keyboardType="email-address"
                />
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.modalButtonCancel} onPress={() => setShowEditModal(false)} activeOpacity={0.8}>
                <Text style={styles.modalButtonTextCancel}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButtonConfirm} onPress={handleSaveProfile} activeOpacity={0.8}>
                <Text style={styles.modalButtonTextConfirm}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPasswordModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>修改密码</Text>
              <TouchableOpacity onPress={() => setShowPasswordModal(false)} activeOpacity={0.5}>
                <X size={28} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>旧密码</Text>
                <TextInput
                  style={styles.formInput}
                  value={passwordForm.oldPassword}
                  onChangeText={(text) => setPasswordForm({ ...passwordForm, oldPassword: text })}
                  placeholder="请输入旧密码"
                  secureTextEntry={true}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>新密码</Text>
                <TextInput
                  style={styles.formInput}
                  value={passwordForm.newPassword}
                  onChangeText={(text) => setPasswordForm({ ...passwordForm, newPassword: text })}
                  placeholder="请输入新密码（至少8位）"
                  secureTextEntry={true}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>确认密码</Text>
                <TextInput
                  style={styles.formInput}
                  value={passwordForm.confirmPassword}
                  onChangeText={(text) => setPasswordForm({ ...passwordForm, confirmPassword: text })}
                  placeholder="请再次输入新密码"
                  secureTextEntry={true}
                />
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.modalButtonCancel} onPress={() => setShowPasswordModal(false)} activeOpacity={0.8}>
                <Text style={styles.modalButtonTextCancel}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButtonConfirm} onPress={handleChangePassword} activeOpacity={0.8}>
                <Text style={styles.modalButtonTextConfirm}>确认修改</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

function handleProfileItem(item: string) {
  switch (item) {
    case '存储空间':
      Alert.alert('功能开发中', '存储空间管理即将推出');
      break;
    case '关于我们':
      Alert.alert('关于 InkWeaver', '版本 1.0.0\n\n一款强大的笔记同步应用');
      break;
    case '意见反馈':
      Alert.alert('功能开发中', '意见反馈功能即将推出');
      break;
    case '通知设置':
      Alert.alert('功能开发中', '通知设置即将推出');
      break;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 120,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingSpinner: {
    width: 40,
    height: 40,
    borderWidth: 3,
    borderColor: '#f1f5f9',
    borderTopColor: '#3b82f6',
    borderRadius: 20,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748b',
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    backgroundColor: '#3b82f6',
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  profileAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  profileName: {
    fontSize: 24,
    fontWeight: '700',
    color: 'white',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  profileSection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 8,
    marginVertical: 12,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  profileSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  profileSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  profileSectionContent: {
    paddingHorizontal: 16,
  },
  profileItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  profileItemLast: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  profileItemLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileItemLabelText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1e293b',
  },
  profileItemArrow: {
    fontSize: 18,
    color: '#94a3b8',
  },
  profileItemValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileItemValueText: {
    fontSize: 14,
    color: '#64748b',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 8,
    marginVertical: 20,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ef4444',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  modalBody: {
    padding: 20,
    maxHeight: 350,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  modalButtonCancel: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
  },
  modalButtonTextCancel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  modalButtonConfirm: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  modalButtonTextConfirm: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  formGroup: {
    marginBottom: 20,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
  },
  formInput: {
    width: '100%',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    fontSize: 15,
    backgroundColor: '#ffffff',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
  },
});
