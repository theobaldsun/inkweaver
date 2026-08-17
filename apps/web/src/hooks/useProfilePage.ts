/**
 * 个人中心页状态与 API 操作。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, UserSettings, UserSessionInfo } from '@inkweaver/shared';
import { DEFAULT_USER_SETTINGS, MIN_PASSWORD_LENGTH, isPasswordLengthValid } from '@inkweaver/shared';
import { authService, userService } from '../services/apiClient';
import { searchService } from '@inkweaver/services';

export type ProfileTabId =
  | 'account'
  | 'notifications'
  | 'privacy'
  | 'storage'
  | 'app'
  | 'help';

export function useProfilePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [activeTab, setActiveTab] = useState<ProfileTabId>('account');

  const [user, setUser] = useState<User | null>(null);
  const [accountForm, setAccountForm] = useState({ name: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  /** 保存前的 settings 快照，用于回滚（防止闭包值过期） */
  const settingsSnapshotRef = useRef<UserSettings>(DEFAULT_USER_SETTINGS);
  const [documentCount, setDocumentCount] = useState(0);
  const [usedBytes, setUsedBytes] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);

  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(''), 3000);
  }, []);

  const handleAuthError = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : '操作失败';
      if (message.includes('401') || message.includes('Unauthorized')) {
        navigate('/login');
        return;
      }
      setError(message);
    },
    [navigate],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [profile, prefs, usage, history] = await Promise.all([
        userService.getProfile(),
        userService.getPreferences(),
        userService.getStorageUsage(),
        searchService.getSearchHistory(100),
      ]);
      setUser(profile);
      setAccountForm({ name: profile.name || '', email: profile.email || '' });
      setSettings(prefs);
      setDocumentCount(usage.documentCount);
      setUsedBytes(usage.usedBytes);
      setSearchCount(history.history?.length ?? 0);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  const loadSessions = useCallback(async () => {
    try {
      const tokens = await authService.getTokens();
      const res = await userService.getSessions(tokens?.sessionId);
      setSessions(res.sessions);
    } catch (err) {
      handleAuthError(err);
    }
  }, [handleAuthError]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (activeTab === 'privacy') {
      loadSessions();
    }
  }, [activeTab, loadSessions]);

  const saveAccount = async () => {
    setSaving(true);
    setError('');
    try {
      if (!accountForm.name.trim()) {
        setError('请输入用户名');
        return;
      }
      const updated = await userService.updateProfile({
        name: accountForm.name.trim(),
      });
      setUser(updated);
      showSuccess('资料已保存');
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setSaving(true);
    setError('');
    try {
      if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
        setError('请填写所有密码字段');
        return;
      }
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        setError('两次输入的新密码不一致');
        return;
      }
      if (!isPasswordLengthValid(passwordForm.newPassword)) {
        setError(`新密码至少 ${MIN_PASSWORD_LENGTH} 位`);
        return;
      }
      await userService.changePassword({
        oldPassword: passwordForm.oldPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      await authService.logout();
      navigate('/login', { state: { message: '密码已更新，请使用新密码重新登录' } });
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setSaving(true);
    setError('');
    try {
      const { avatarUrl } = await userService.uploadAvatar(file);
      setUser((prev) => (prev ? { ...prev, avatarUrl } : prev));
      showSuccess('头像已更新');
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (partial: Partial<UserSettings>) => {
    // 快照当前 settings，用于失败时回滚（防止因闭包值过期导致回滚数据错误）
    const snapshot = settingsSnapshotRef.current;
    const next = { ...settings, ...partial };
    setSettings(next);
    setSaving(true);
    setError('');
    try {
      const saved = await userService.updatePreferences(partial);
      settingsSnapshotRef.current = saved;
      setSettings(saved);
      showSuccess('设置已保存');
    } catch (err) {
      // 使用保存前的快照回滚，而非闭包捕获的 settings（可能已过期）
      setSettings(snapshot);
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const exportData = async (password: string) => {
    setSaving(true);
    setError('');
    try {
      const blob = await userService.exportData(password);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inkweaver-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccess('导出已开始下载');
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteAllData = async (password: string) => {
    setSaving(true);
    setError('');
    try {
      await userService.deleteAllData(password);
      showSuccess('已删除全部数据');
      await loadAll();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (password: string) => {
    setSaving(true);
    setError('');
    try {
      await userService.deleteAccount(password);
      await authService.logout();
      navigate('/login');
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    try {
      await authService.logout();
      navigate('/login');
    } catch (err) {
      handleAuthError(err);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await userService.revokeSession(sessionId);
      showSuccess('会话已撤销');
      await loadSessions();
    } catch (err) {
      handleAuthError(err);
    }
  };

  const revokeAllSessions = async () => {
    try {
      const tokens = await authService.getTokens();
      await userService.revokeAllSessions(tokens?.sessionId);
      showSuccess('已撤销其他会话');
      await loadSessions();
    } catch (err) {
      handleAuthError(err);
    }
  };

  return {
    loading,
    saving,
    error,
    setError,
    successMessage,
    activeTab,
    setActiveTab,
    user,
    accountForm,
    setAccountForm,
    passwordForm,
    setPasswordForm,
    settings,
    documentCount,
    usedBytes,
    searchCount,
    sessions,
    saveAccount,
    changePassword,
    uploadAvatar,
    saveSettings,
    exportData,
    deleteAllData,
    deleteAccount,
    logout,
    revokeSession,
    revokeAllSessions,
    loadAll,
  };
}
