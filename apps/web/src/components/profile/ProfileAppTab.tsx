/**
 * 应用与编辑器设置 Tab。
 */

import React from 'react';
import type { UserSettings } from '@inkweaver/shared';

interface ProfileAppTabProps {
  settings: UserSettings;
  saving: boolean;
  onSave: (partial: Partial<UserSettings>) => void;
}

const FONT_OPTIONS = ['微软雅黑', '宋体', '黑体', 'Arial'];
const SIZE_OPTIONS = ['14px', '16px', '18px', '20px'];

export const ProfileAppTab: React.FC<ProfileAppTabProps> = ({ settings, saving, onSave }) => (
  <div className="settings-content">
    <div className="section-card">
      <h3 className="section-title">编辑器设置</h3>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">默认字体</label>
          <select
            className="form-input"
            value={settings.editorFontFamily}
            disabled={saving}
            onChange={(e) => onSave({ editorFontFamily: e.target.value })}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">字体大小</label>
          <select
            className="form-input"
            value={settings.editorFontSize}
            disabled={saving}
            onChange={(e) => onSave({ editorFontSize: e.target.value })}
          >
            {SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
    <div className="section-card">
      <h3 className="section-title">快捷键</h3>
      <div className="shortcut-grid">
        <div className="shortcut-item">
          <kbd>Ctrl</kbd>
          <span>+</span>
          <kbd>S</kbd>
          <span className="shortcut-desc">保存文档</span>
        </div>
        <div className="shortcut-item">
          <kbd>Ctrl</kbd>
          <span>+</span>
          <kbd>Z</kbd>
          <span className="shortcut-desc">撤销</span>
        </div>
        <div className="shortcut-item">
          <kbd>Ctrl</kbd>
          <span>+</span>
          <kbd>Y</kbd>
          <span className="shortcut-desc">重做</span>
        </div>
        <div className="shortcut-item">
          <kbd>Ctrl</kbd>
          <span>+</span>
          <kbd>B</kbd>
          <span className="shortcut-desc">加粗</span>
        </div>
        <div className="shortcut-item">
          <kbd>Ctrl</kbd>
          <span>+</span>
          <kbd>N</kbd>
          <span className="shortcut-desc">新建文档</span>
        </div>
      </div>
    </div>
  </div>
);
