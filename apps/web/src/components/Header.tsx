import React, { useState } from 'react';
import { Search, Plus, User, X, LogOut, Sparkles } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/apiClient';
import CustomModal from './CustomModal';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchValue.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchValue.trim())}`);
    }
  };

  const handleClearSearch = () => {
    setSearchValue('');
  };

  const handleUserClick = () => {
    navigate('/profile');
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    try {
      await authService.logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
    setShowLogoutConfirm(false);
  };

  return (
    <>
      <header className="header">
        <div className="header-left">
          <h1 className="header-title">InkWeaver</h1>
        </div>

        <div className="header-center">
          <div className={`search-box ${isSearchFocused ? 'focused' : ''}`}>
            <Search size={18} />
            <input
              type="text"
              aria-label="搜索文档"
              placeholder="搜索文档..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              onKeyDown={handleSearch}
            />
            {searchValue && (
              <button type="button" onClick={handleClearSearch} aria-label="清空搜索">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="header-btn"
            onClick={() => navigate('/ai')}
            title="笔记问答"
            aria-label="笔记问答"
          >
            <Sparkles size={20} />
          </button>
          <button
            type="button"
            className="header-btn" 
            onClick={() => navigate('/documents/new')}
            title="新建文档"
            aria-label="新建文档"
          >
            <Plus size={20} />
          </button>
          <NotificationBell />
          <button
            type="button"
            className="header-btn" 
            onClick={handleLogout}
            title="退出登录"
            aria-label="退出登录"
          >
            <LogOut size={20} />
          </button>
          <button
            type="button"
            className="user-avatar"
            onClick={handleUserClick}
            title="个人资料"
            aria-label="个人资料"
          >
            <User size={18} />
          </button>
        </div>
      </header>

      <CustomModal
        isOpen={showLogoutConfirm}
        title="确认退出"
        message="确定要退出登录吗？"
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
};

export default Header;
