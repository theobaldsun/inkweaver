import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService, userService } from '@inkweaver/services';
import { StorageUsagePanel } from '@inkweaver/ui';
import { formatStorageSize } from '@inkweaver/shared';
import { User, FileText, Search, Settings, Shield, Bell, HardDrive, Info, MessageSquare, LogOut, X } from 'lucide-react';
import type { User as UserType } from '@inkweaver/shared';
import { showAlert } from '../components/CustomModal';

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserType | null>(null);
  const [storageStats, setStorageStats] = useState<{ documentCount: number; usedStorage: number; totalStorage: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

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
      if (error instanceof Error) {
        if (error.message.includes('401')) {
          navigate('/login');
        }
      }
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
    authService.logout();
    navigate('/login');
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
      setSuccessMessage('个人信息更新成功');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('更新个人信息失败:', error);
      if (error instanceof Error) {
        setError(error.message);
      }
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
      setSuccessMessage('密码修改成功');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('修改密码失败:', error);
      if (error instanceof Error) {
        setError(error.message);
      }
    }
  };

  if (loading) {
    return (
      <div className="main-content profile-container">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <span className="loading-text">加载中...</span>
        </div>
      </div>
    );
  }

  const displayName = user?.name || '用户名称';
  const displayEmail = user?.email || '';

  return (
    <div className="main-content profile-container">
      {successMessage && (
        <div className="success-message">
          {successMessage}
        </div>
      )}

      <div className="profile-header">
        <div className="profile-avatar">
          <User size={40} />
        </div>
        <div className="profile-name">{displayName}</div>
        <div className="profile-email">{displayEmail}</div>
      </div>

      <div className="profile-section">
        <div className="profile-section-title">
          <Settings size={16} className="section-icon" />
          账户设置
        </div>
        <div className="profile-section-content">
          <div 
            className="profile-item"
            onClick={() => setShowEditModal(true)}
          >
            <div className="profile-item-label">
              <User size={18} className="profile-item-icon" />
              <span>个人信息</span>
            </div>
            <div className="profile-item-value">
              <span>{displayName}</span>
              <span className="arrow">›</span>
            </div>
          </div>
          <div 
            className="profile-item"
            onClick={() => setShowPasswordModal(true)}
          >
            <div className="profile-item-label">
              <Shield size={18} className="profile-item-icon" />
              <span>密码设置</span>
            </div>
            <div className="profile-item-value">
              <span>*******</span>
              <span className="arrow">›</span>
            </div>
          </div>
          <div 
            className="profile-item"
            onClick={() => handleProfileItem('通知设置')}
          >
            <div className="profile-item-label">
              <Bell size={18} className="profile-item-icon" />
              <span>通知设置</span>
            </div>
            <div className="profile-item-value">
              <span className="arrow">›</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-section profile-section--storage">
        <div className="profile-section-title">
          <HardDrive size={16} className="section-icon" />
          存储空间
        </div>
        <StorageUsagePanel pollIntervalMs={60_000} />
      </div>

      <div className="profile-section">
        <div className="profile-section-title">
          <Info size={16} className="section-icon" />
          其他设置
        </div>
        <div className="profile-section-content">
          <div className="profile-item profile-item--readonly">
            <div className="profile-item-label">
              <HardDrive size={18} className="profile-item-icon" />
              <span>存储摘要</span>
            </div>
            <div className="profile-item-value">
              <span>
                {storageStats
                  ? `${formatStorageSize(storageStats.usedStorage)} / ${formatStorageSize(storageStats.totalStorage)}`
                  : '加载中…'}
              </span>
            </div>
          </div>
          <div 
            className="profile-item"
            onClick={() => handleProfileItem('关于我们')}
          >
            <div className="profile-item-label">
              <Info size={18} className="profile-item-icon" />
              <span>关于我们</span>
            </div>
            <div className="profile-item-value">
              <span>v1.0.0</span>
              <span className="arrow">›</span>
            </div>
          </div>
          <div 
            className="profile-item last"
            onClick={() => handleProfileItem('意见反馈')}
          >
            <div className="profile-item-label">
              <MessageSquare size={18} className="profile-item-icon" />
              <span>意见反馈</span>
            </div>
            <div className="profile-item-value">
              <span className="arrow">›</span>
            </div>
          </div>
        </div>
      </div>

      <button 
        className="logout-button"
        onClick={handleLogout}
      >
        <LogOut size={18} />
        退出登录
      </button>

      <div className="bottom-nav">
        <Link to="/notes" className="nav-item">
          <FileText className="nav-icon" size={22} />
          <div className="nav-label">笔记</div>
        </Link>
        <Link to="/search" className="nav-item">
          <Search className="nav-icon" size={22} />
          <div className="nav-label">搜索</div>
        </Link>
        <Link to="/profile" className="nav-item active">
          <User className="nav-icon" size={22} />
          <div className="nav-label">我的</div>
        </Link>
      </div>

      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>编辑个人信息</h3>
              <button className="modal-close" onClick={() => setShowEditModal(false)}><X size={24} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="error-message">{error}</div>}
              <div className="form-group">
                <label>用户名</label>
                <input
                  type="text"
                  className="form-input"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="请输入用户名"
                />
              </div>
              <div className="form-group">
                <label>邮箱</label>
                <input
                  type="email"
                  className="form-input"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="请输入邮箱"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveProfile}>保存</button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>修改密码</h3>
              <button className="modal-close" onClick={() => setShowPasswordModal(false)}><X size={24} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="error-message">{error}</div>}
              <div className="form-group">
                <label>旧密码</label>
                <input
                  type="password"
                  className="form-input"
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                  placeholder="请输入旧密码"
                />
              </div>
              <div className="form-group">
                <label>新密码</label>
                <input
                  type="password"
                  className="form-input"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  placeholder="请输入新密码（至少8位）"
                />
              </div>
              <div className="form-group">
                <label>确认密码</label>
                <input
                  type="password"
                  className="form-input"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  placeholder="请再次输入新密码"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleChangePassword}>确认修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function handleProfileItem(item: string) {
  console.log('点击:', item);
  switch (item) {
    case '存储空间':
      showAlert('提示', '存储空间功能开发中', 'info');
      break;
    case '关于我们':
      showAlert('关于 InkWeaver', '版本 1.0.0\n\n一款强大的笔记同步应用', 'info');
      break;
    case '意见反馈':
      showAlert('提示', '意见反馈功能开发中', 'info');
      break;
    case '通知设置':
      showAlert('提示', '通知设置功能开发中', 'info');
      break;
  }
}
