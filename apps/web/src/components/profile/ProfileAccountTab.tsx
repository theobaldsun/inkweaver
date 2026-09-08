/**
 * 账户设置 Tab：资料、改密、退出与删号入口。
 */

import { MIN_PASSWORD_LENGTH, type User as UserType } from '@inkweaver/shared';
import { LogOut, Trash2, User } from 'lucide-react';
import React, { useState } from 'react';

import { getAssetUrl } from '../../utils/assetUrl';
import CustomModal from '../CustomModal';


interface ProfileAccountTabProps {
  user: UserType | null;
  accountForm: { name: string; email: string };
  setAccountForm: React.Dispatch<React.SetStateAction<{ name: string; email: string }>>;
  passwordForm: { oldPassword: string; newPassword: string; confirmPassword: string };
  setPasswordForm: React.Dispatch<
    React.SetStateAction<{ oldPassword: string; newPassword: string; confirmPassword: string }>
  >;
  saving: boolean;
  onSaveAccount: () => void;
  onChangePassword: () => void;
  onUploadAvatar: (file: File) => void;
  onLogout: () => void;
  onDeleteAccount: (password: string) => void;
}

export const ProfileAccountTab: React.FC<ProfileAccountTabProps> = ({
  user,
  accountForm,
  setAccountForm,
  passwordForm,
  setPasswordForm,
  saving,
  onSaveAccount,
  onChangePassword,
  onUploadAvatar,
  onLogout,
  onDeleteAccount,
}) => {
  const [showLogout, setShowLogout] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const avatarSrc = getAssetUrl(user?.avatarUrl);

  return (
    <div className="settings-content">
      <div className="section-card">
        <h3 className="section-title">基本信息</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">用户名</label>
            <input
              type="text"
              value={accountForm.name}
              onChange={(e) => setAccountForm((f) => ({ ...f, name: e.target.value }))}
              className="form-input"
              placeholder="输入用户名"
            />
          </div>
          <div className="form-group">
            <label className="form-label">邮箱地址</label>
            <input
              type="email"
              value={accountForm.email}
              readOnly
              disabled
              className="form-input form-input--readonly"
              title="注册邮箱不可修改"
            />
            <p className="form-hint">注册邮箱不可修改</p>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">头像</label>
          <div className="avatar-upload-row">
            <div className="avatar-preview">
              {avatarSrc ? <img src={avatarSrc} alt="" className="avatar-preview-img" /> : <User size={32} />}
            </div>
            <label className="btn btn-secondary upload-btn">
              上传头像
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                disabled={saving}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onUploadAvatar(file);
                  }
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">密码安全</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">当前密码</label>
            <input
              type="password"
              value={passwordForm.oldPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, oldPassword: e.target.value }))}
              className="form-input"
              placeholder="请输入当前密码"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">新密码</label>
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
              className="form-input"
              placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
          <div className="form-group">
            <label className="form-label">确认密码</label>
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              className="form-input"
              placeholder="请确认新密码"
            />
          </div>
        </div>
        <p className="form-hint">
          提交前会在浏览器内做 SHA-256 摘要，网络请求中不会携带可读明文密码；服务端仅保存摘要的 bcrypt 哈希。修改成功后将退出全部设备。
        </p>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={onChangePassword}>
          更新密码
        </button>
      </div>

      <div className="section-card danger-section">
        <h3 className="section-title">危险操作</h3>
        <div className="action-row">
          <button type="button" className="action-btn" onClick={() => setShowLogout(true)}>
            <LogOut size={18} />
            <span>退出登录</span>
          </button>
          <button type="button" className="action-btn danger" onClick={() => setShowDeleteAccount(true)}>
            <Trash2 size={18} />
            <span>删除账户</span>
          </button>
        </div>
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setAccountForm({ name: user?.name || '', email: user?.email || '' });
          }}
        >
          取消
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={onSaveAccount}>
          保存更改
        </button>
      </div>

      <CustomModal
        isOpen={showLogout}
        title="确认退出"
        message="确定要退出登录吗？"
        onConfirm={() => {
          setShowLogout(false);
          onLogout();
        }}
        onCancel={() => setShowLogout(false)}
      />

      <CustomModal
        isOpen={showDeleteAccount}
        title="删除账户"
        message="此操作不可恢复。请输入密码确认注销账户。"
        showCustomContent
        customContent={
          <input
            type="password"
            className="form-input"
            placeholder="登录密码"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
          />
        }
        onConfirm={() => {
          onDeleteAccount(deletePassword);
          setShowDeleteAccount(false);
          setDeletePassword('');
        }}
        onCancel={() => {
          setShowDeleteAccount(false);
          setDeletePassword('');
        }}
      />
    </div>
  );
};
