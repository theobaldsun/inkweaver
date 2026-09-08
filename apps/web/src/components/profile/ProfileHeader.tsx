/**
 * 个人中心顶栏：头像与统计卡片。
 */

import { formatStorageSize } from '@inkweaver/shared';
import { User, FileText, BarChart3, Clock, Edit3 } from 'lucide-react';
import React, { useRef } from 'react';

import { getAssetUrl } from '../../utils/assetUrl';

import type { User as UserType } from '@inkweaver/shared';



interface ProfileHeaderProps {
  user: UserType | null;
  documentCount: number;
  usedBytes: number;
  searchCount: number;
  saving: boolean;
  onAvatarSelect: (file: File) => void;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  user,
  documentCount,
  usedBytes,
  searchCount,
  saving,
  onAvatarSelect,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarSrc = getAssetUrl(user?.avatarUrl);

  return (
    <div className="profile-header">
      <div className="user-info">
        <div className="avatar-section">
          <div className="user-avatar-large">
            {avatarSrc ? (
              <img src={avatarSrc} alt="" className="user-avatar-img" />
            ) : (
              <User size={64} />
            )}
          </div>
          <button
            type="button"
            className="edit-avatar-btn"
            disabled={saving}
            onClick={() => fileRef.current?.click()}
          >
            <Edit3 size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onAvatarSelect(file);
              }
              e.target.value = '';
            }}
          />
        </div>
        <div className="user-details">
          <h1 className="user-name">{user?.name || '用户'}</h1>
          <p className="user-email">{user?.email || ''}</p>
        </div>
      </div>
      <div className="user-stats-row">
        <div className="stat-card">
          <FileText size={20} />
          <div className="stat-info">
            <span className="stat-number">{documentCount}</span>
            <span className="stat-label">笔记</span>
          </div>
        </div>
        <div className="stat-card">
          <BarChart3 size={20} />
          <div className="stat-info">
            <span className="stat-number">{formatStorageSize(usedBytes)}</span>
            <span className="stat-label">已用</span>
          </div>
        </div>
        <div className="stat-card">
          <Clock size={20} />
          <div className="stat-info">
            <span className="stat-number">{searchCount}</span>
            <span className="stat-label">搜索</span>
          </div>
        </div>
      </div>
    </div>
  );
};
