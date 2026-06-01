/**
 * 编辑器「更多」下拉菜单：链接、导出、公开状态、分享链接。
 */

import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Link2, Download, Globe, Share2 } from 'lucide-react';

export interface EditorMoreMenuProps {
  docId?: string;
  isPublic?: boolean;
  onCopyLink: () => void;
  onExportHtml: () => void;
  onTogglePublic: () => void;
  onGenerateShareLink: () => void;
}

export const EditorMoreMenu: React.FC<EditorMoreMenuProps> = ({
  docId,
  isPublic,
  onCopyLink,
  onExportHtml,
  onTogglePublic,
  onGenerateShareLink,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="editor-more-menu" ref={rootRef}>
      <button
        type="button"
        className="editor-btn secondary"
        onClick={() => setOpen((v) => !v)}
        title="更多"
        aria-expanded={open}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="editor-more-dropdown" role="menu">
          <button type="button" role="menuitem" onClick={() => run(onCopyLink)} disabled={!docId}>
            <Link2 size={16} />
            复制文档链接
          </button>
          <button type="button" role="menuitem" onClick={() => run(onExportHtml)}>
            <Download size={16} />
            导出 HTML
          </button>
          <button type="button" role="menuitem" onClick={() => run(onTogglePublic)} disabled={!docId}>
            <Globe size={16} />
            {isPublic ? '设为私有' : '设为公开'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onGenerateShareLink)}
            disabled={!docId}
          >
            <Share2 size={16} />
            复制公开分享链接
          </button>
        </div>
      )}
    </div>
  );
};
