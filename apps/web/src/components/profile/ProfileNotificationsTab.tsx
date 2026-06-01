/**
 * 通知 Tab：收件箱 + 通知偏好。
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { UserSettings } from '@inkweaver/shared';
import { notificationApi, type NotificationItem } from '@inkweaver/api';

interface ProfileNotificationsTabProps {
  settings: UserSettings;
  saving: boolean;
  onSave: (partial: Partial<UserSettings>) => void;
}

export const ProfileNotificationsTab: React.FC<ProfileNotificationsTabProps> = ({
  settings,
  saving,
  onSave,
}) => {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(true);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const res = await notificationApi.list();
      setItems(res.items);
      setUnreadCount(res.unreadCount);
    } catch (e) {
      console.error(e);
      setItems([]);
      setUnreadCount(0);
    } finally {
      setInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const markRead = async (id: string) => {
    await notificationApi.markRead(id);
    await loadInbox();
  };

  const markAllRead = async () => {
    await notificationApi.markAllRead();
    await loadInbox();
  };

  return (
    <div className="settings-content">
      <div className="section-card">
        <div className="section-card__head-row">
          <h3 className="section-title">通知收件箱</h3>
          {unreadCount > 0 && (
            <button type="button" className="btn-link" onClick={() => void markAllRead()}>
              全部标为已读（{unreadCount}）
            </button>
          )}
        </div>
        {inboxLoading && <p className="profile-inbox-empty">加载中…</p>}
        {!inboxLoading && items.length === 0 && (
          <p className="profile-inbox-empty">暂无通知</p>
        )}
        <ul className="profile-inbox-list">
          {items.map((n) => (
            <li
              key={n.id}
              className={`profile-inbox-item ${n.readAt ? 'read' : 'unread'}`}
            >
              <button type="button" className="profile-inbox-item__btn" onClick={() => void markRead(n.id)}>
                <strong>{n.title}</strong>
                <span>{n.body}</span>
                <time>{new Date(n.createdAt).toLocaleString()}</time>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="section-card">
        <h3 className="section-title">通知偏好</h3>
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>邮件通知</h4>
            <p>接收重要更新和消息通知</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.emailNotifications}
              disabled={saving}
              onChange={(e) => onSave({ emailNotifications: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>浏览器通知</h4>
            <p>允许浏览器发送推送通知</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.browserNotifications}
              disabled={saving}
              onChange={(e) => onSave({ browserNotifications: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>文档更新通知</h4>
            <p>当文档被更新时通知您</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.docUpdateNotifications}
              disabled={saving}
              onChange={(e) => onSave({ docUpdateNotifications: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>
      </div>
    </div>
  );
};
