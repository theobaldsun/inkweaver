/**
 * 帮助中心 Tab：使用指南与常用入口。
 */

import { HelpCircle, FileText, Bell, MessageCircle, Trash2, Search } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

export const ProfileHelpTab: React.FC = () => (
  <div className="settings-content">
    <div className="section-card">
      <h3 className="section-title">使用指南</h3>
      <ul className="help-guide-list">
        <li>在侧栏或笔记页点击「新建文档」开始写作，支持富文本与代码块。</li>
        <li>文档会自动保存到本地，并在联网后同步到云端；编辑页可查看连接状态。</li>
        <li>使用顶栏搜索或「搜索」页可全文检索笔记；支持从顶栏带关键词跳转。</li>
        <li>删除的文档进入回收站，可在保留期内恢复或永久删除。</li>
        <li>在「公开文档」筛选中查看已设为公开的笔记（需在编辑更多菜单中开启）。</li>
      </ul>
    </div>

    <div className="section-card">
      <h3 className="section-title">快捷入口</h3>
      <div className="help-grid">
        <Link to="/notes" className="help-card help-card-link">
          <div className="help-icon">
            <FileText size={24} />
          </div>
          <h4>我的笔记</h4>
          <p>浏览与管理全部文档</p>
        </Link>
        <Link to="/search" className="help-card help-card-link">
          <div className="help-icon">
            <Search size={24} />
          </div>
          <h4>搜索</h4>
          <p>全文检索笔记内容</p>
        </Link>
        <Link to="/trash" className="help-card help-card-link">
          <div className="help-icon">
            <Trash2 size={24} />
          </div>
          <h4>回收站</h4>
          <p>恢复或永久删除文档</p>
        </Link>
        <Link to="/profile?tab=notifications" className="help-card help-card-link">
          <div className="help-icon">
            <Bell size={24} />
          </div>
          <h4>通知设置</h4>
          <p>邮件与浏览器通知偏好</p>
        </Link>
      </div>
    </div>

    <div className="section-card">
      <h3 className="section-title">反馈与支持</h3>
      <div className="help-grid">
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="help-card help-card-link"
        >
          <div className="help-icon">
            <MessageCircle size={24} />
          </div>
          <h4>意见反馈</h4>
          <p>通过项目 Issue 提交问题与建议</p>
        </a>
        <div className="help-card help-card-static">
          <div className="help-icon">
            <HelpCircle size={24} />
          </div>
          <h4>API 文档</h4>
          <p>后端启动后访问 /api/docs（Swagger）</p>
        </div>
      </div>
    </div>
  </div>
);
