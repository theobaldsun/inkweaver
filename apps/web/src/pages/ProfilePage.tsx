/**
 * 个人中心页面。
 */

import { User, Settings, HelpCircle, Shield, Bell, BarChart3 } from 'lucide-react';
import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ProfileAccountTab } from '../components/profile/ProfileAccountTab';
import { ProfileAppTab } from '../components/profile/ProfileAppTab';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { ProfileHelpTab } from '../components/profile/ProfileHelpTab';
import { ProfileNotificationsTab } from '../components/profile/ProfileNotificationsTab';
import { ProfilePrivacyTab } from '../components/profile/ProfilePrivacyTab';
import { ProfileStorageTab } from '../components/profile/ProfileStorageTab';
import { useProfilePage, type ProfileTabId } from '../hooks/useProfilePage';

const TABS: { id: ProfileTabId; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'account', label: '账户设置', icon: User },
  { id: 'notifications', label: '通知设置', icon: Bell },
  { id: 'privacy', label: '隐私安全', icon: Shield },
  { id: 'storage', label: '存储空间', icon: BarChart3 },
  { id: 'app', label: '应用设置', icon: Settings },
  { id: 'help', label: '帮助中心', icon: HelpCircle },
];

const TAB_IDS = new Set<ProfileTabId>(['account', 'notifications', 'privacy', 'storage', 'app', 'help']);

export const ProfilePage: React.FC = () => {
  const profile = useProfilePage();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab') as ProfileTabId | null;
    if (tab && TAB_IDS.has(tab)) {
      profile.setActiveTab(tab);
    }
  }, [searchParams, profile.setActiveTab]);

  if (profile.loading) {
    return (
      <div className="profile-page">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p className="loading-text">加载中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      {profile.successMessage && <div className="success-message profile-banner">{profile.successMessage}</div>}
      {profile.error && (
        <div className="error-message profile-banner">
          {profile.error}
          <button type="button" className="profile-dismiss-error" onClick={() => profile.setError('')}>
            ×
          </button>
        </div>
      )}

      <ProfileHeader
        user={profile.user}
        documentCount={profile.documentCount}
        usedBytes={profile.usedBytes}
        searchCount={profile.searchCount}
        saving={profile.saving}
        onAvatarSelect={profile.uploadAvatar}
      />

      <div className="profile-content">
        <div className="tabs-container">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-item ${profile.activeTab === tab.id ? 'active' : ''}`}
              onClick={() => profile.setActiveTab(tab.id)}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="tab-content">
          {profile.activeTab === 'account' && (
            <ProfileAccountTab
              user={profile.user}
              accountForm={profile.accountForm}
              setAccountForm={profile.setAccountForm}
              passwordForm={profile.passwordForm}
              setPasswordForm={profile.setPasswordForm}
              saving={profile.saving}
              onSaveAccount={profile.saveAccount}
              onChangePassword={profile.changePassword}
              onUploadAvatar={profile.uploadAvatar}
              onLogout={profile.logout}
              onDeleteAccount={profile.deleteAccount}
            />
          )}
          {profile.activeTab === 'notifications' && (
            <ProfileNotificationsTab
              settings={profile.settings}
              saving={profile.saving}
              onSave={profile.saveSettings}
            />
          )}
          {profile.activeTab === 'privacy' && (
            <ProfilePrivacyTab
              settings={profile.settings}
              sessions={profile.sessions}
              saving={profile.saving}
              onSave={profile.saveSettings}
              onExport={profile.exportData}
              onDeleteAllData={profile.deleteAllData}
              onRevokeSession={profile.revokeSession}
              onRevokeAllSessions={profile.revokeAllSessions}
            />
          )}
          {profile.activeTab === 'storage' && <ProfileStorageTab />}
          {profile.activeTab === 'app' && (
            <ProfileAppTab settings={profile.settings} saving={profile.saving} onSave={profile.saveSettings} />
          )}
          {profile.activeTab === 'help' && <ProfileHelpTab />}
        </div>
      </div>
    </div>
  );
};
