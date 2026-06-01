/**
 * 顶栏通知铃铛：未读数 + 最近通知下拉。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notificationApi, type NotificationItem } from '@inkweaver/api';

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationApi.list();
      setItems(res.items.slice(0, 10));
      setUnreadCount(res.unreadCount);
    } catch (e) {
      console.error('Failed to load notifications', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, load]);

  const markRead = async (id: string) => {
    await notificationApi.markRead(id);
    await load();
  };

  const markAllRead = async () => {
    await notificationApi.markAllRead();
    await load();
  };

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        type="button"
        className="header-btn notification-bell__btn"
        title="通知"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="notification-bell__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <div className="notification-bell__panel">
          <div className="notification-bell__head">
            <span>通知</span>
            {unreadCount > 0 && (
              <button type="button" className="notification-bell__mark-all" onClick={() => void markAllRead()}>
                全部已读
              </button>
            )}
          </div>
          {loading && <p className="notification-bell__empty">加载中…</p>}
          {!loading && items.length === 0 && (
            <p className="notification-bell__empty">暂无通知</p>
          )}
          <ul className="notification-bell__list">
            {items.map((n) => (
              <li
                key={n.id}
                className={n.readAt ? 'read' : 'unread'}
                onClick={() => void markRead(n.id)}
              >
                <strong>{n.title}</strong>
                <p>{n.body}</p>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="notification-bell__footer"
            onClick={() => {
              setOpen(false);
              navigate('/profile?tab=notifications');
            }}
          >
            查看全部
          </button>
        </div>
      )}
    </div>
  );
};
