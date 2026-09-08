/**
 * 隐私与安全 Tab：偏好、数据管理、会话列表。
 */

import { Download, Trash2, ChevronRight, Monitor } from 'lucide-react';
import React, { useState } from 'react';

import CustomModal from '../CustomModal';

import type { UserSettings, UserSessionInfo } from '@inkweaver/shared';


interface ProfilePrivacyTabProps {
  settings: UserSettings;
  sessions: UserSessionInfo[];
  saving: boolean;
  onSave: (partial: Partial<UserSettings>) => void;
  onExport: (password: string) => void;
  onDeleteAllData: (password: string) => void;
  onRevokeSession: (sessionId: string) => void;
  onRevokeAllSessions: () => void;
}

export const ProfilePrivacyTab: React.FC<ProfilePrivacyTabProps> = ({
  settings,
  sessions,
  saving,
  onSave,
  onExport,
  onDeleteAllData,
  onRevokeSession,
  onRevokeAllSessions,
}) => {
  const [modal, setModal] = useState<'export' | 'deleteData' | null>(null);
  const [password, setPassword] = useState('');

  const closeModal = () => {
    setModal(null);
    setPassword('');
  };

  const confirmModal = () => {
    if (modal === 'export') {
      onExport(password);
    } else if (modal === 'deleteData') {
      onDeleteAllData(password);
    }
    closeModal();
  };

  return (
    <div className="settings-content">
      <div className="section-card">
        <h3 className="section-title">隐私设置</h3>
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>在线状态</h4>
            <p>显示您的在线状态</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.showOnlineStatus}
              disabled={saving}
              onChange={(e) => onSave({ showOnlineStatus: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>文档共享</h4>
            <p>允许他人查看您的文档</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.allowDocSharing}
              disabled={saving}
              onChange={(e) => onSave({ allowDocSharing: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">登录设备</h3>
        {sessions.length === 0 ? (
          <p className="profile-empty-hint">暂无活跃会话记录</p>
        ) : (
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id} className="session-list-item">
                <div className="session-list-main">
                  <Monitor size={18} />
                  <div>
                    <strong>
                      {s.deviceName || s.browser || s.deviceType || '未知设备'}
                      {s.isCurrent ? '（当前）' : ''}
                    </strong>
                    <p>
                      {s.os || '—'} · 最后活动 {new Date(s.lastActivityAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={saving}
                    onClick={() => onRevokeSession(s.id)}
                  >
                    撤销
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {sessions.length > 1 && (
          <button type="button" className="btn btn-secondary profile-mt-md" disabled={saving} onClick={onRevokeAllSessions}>
            撤销其他设备会话
          </button>
        )}
      </div>

      <div className="section-card">
        <h3 className="section-title">数据管理</h3>
        <button type="button" className="data-action-btn" onClick={() => setModal('export')}>
          <Download size={18} />
          <span>导出所有数据</span>
          <ChevronRight size={16} />
        </button>
        <button type="button" className="data-action-btn danger" onClick={() => setModal('deleteData')}>
          <Trash2 size={18} />
          <span>删除所有数据（保留账户）</span>
          <ChevronRight size={16} />
        </button>
      </div>

      <CustomModal
        isOpen={modal !== null}
        title={modal === 'export' ? '导出数据' : '删除所有数据'}
        message={
          modal === 'export'
            ? '将下载包含文档与设置的 JSON 文件。请输入密码确认。'
            : '将永久删除您的全部笔记与文件夹（含回收站），账户保留。请输入密码确认。'
        }
        showCustomContent
        customContent={
          <input
            type="password"
            className="form-input"
            placeholder="登录密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        }
        onConfirm={confirmModal}
        onCancel={closeModal}
      />
    </div>
  );
};
