import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import UnderlineExtension from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { lowlight } from 'lowlight';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Minus,
  Link2,
  ImageIcon,
  Undo,
  Redo,
  Menu,
  X,
  BookOpen,
  Bot,
  FileText,
  Trash2,
  Download,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import React, { useState, useCallback, useRef, useEffect, useId } from 'react';

import type { EditorConfig, EditorChangeEvent } from '@inkweaver/editor-core';
import type { Editor } from '@tiptap/core';
import './InkWeaverEditor.css';

interface InkWeaverEditorProps extends EditorConfig {
  content: string;
  onChange: (event: EditorChangeEvent) => void;
  imageUploader?: (file: File) => Promise<string>;
  title?: string;
  onTitleChange?: (title: string) => void;
  mobileMode?: boolean;
  showTitleInput?: boolean;
}

interface OutlineItem {
  id: string;
  level: number;
  text: string;
}

export const InkWeaverEditor: React.FC<InkWeaverEditorProps> = ({
  content,
  onChange,
  placeholder = '开始输入内容...',
  editable = true,
  minHeight = 600,
  maxHeight,
  imageUploader,
  title: titleProp = '无标题文档',
  onTitleChange,
  mobileMode = false,
  showTitleInput = true,
}) => {
  const [title, setTitle] = useState<string>(titleProp);
  const prevTitlePropRef = useRef<string>(titleProp);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const linkDialogTitleId = useId();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      UnderlineExtension,
      Link.configure({
        openOnClick: false,
      }),
      Image,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content: content || '',
    editable,
    editorProps: {
      attributes: {
        class: 'inkweaver-content',
        style: minHeight ? `min-height: ${minHeight}px` : undefined,
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const text = editor.getText();
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const charCount = text.length;

      onChange({
        content: html,
        html,
        text,
        wordCount,
        charCount,
      });

      updateOutline(editor);
    },
  });

  const prevContentRef = useRef(content);
  useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      const currentContent = editor.getHTML();
      if (currentContent !== content) {
        editor.commands.setContent(content, false);
      }
      prevContentRef.current = content;
    }
  }, [content, editor]);

  useEffect(() => {
    if (titleProp !== prevTitlePropRef.current && titleProp !== title) {
      setTitle(titleProp);
      prevTitlePropRef.current = titleProp;
    }
  }, [titleProp, title]);

  const handleTitleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setTitle(value);
    onTitleChange?.(value);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setShowSidebar(false);
      }
    };

    if (showSidebar) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSidebar]);

  useEffect(() => {
    if (!showLinkModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowLinkModal(false);
        setLinkUrl('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showLinkModal]);

  const updateOutline = useCallback((editorInstance: Editor) => {
    const headings: OutlineItem[] = [];
    editorInstance.state.doc.descendants((node, pos: number) => {
      if (node.type.name === 'heading') {
        headings.push({
          id: `heading-${pos}`,
          level: node.attrs.level,
          text: node.textContent,
        });
      }
    });
    setOutline(headings);
  }, []);

  const handleSetLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    setLinkUrl(previousUrl || '');
    setShowLinkModal(true);
  };

  const confirmLink = () => {
    if (!editor) return;
    if (linkUrl === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run();
    }
    setShowLinkModal(false);
    setLinkUrl('');
  };

  const cancelLink = () => {
    setShowLinkModal(false);
    setLinkUrl('');
  };

  const addImage = async () => {
    if (!editor || !imageUploader) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const url = await imageUploader(file);
          editor.chain().focus().setImage({ src: url }).run();
        } catch (error) {
          console.error('图片上传失败:', error);
        }
      }
    };
    input.click();
  };

  if (!editor) {
    return null;
  }

  return (
    <div className={`inkweaver-editor ${mobileMode ? 'mobile' : ''}`}>
      <div className={`editor-sidebar left ${showSidebar ? 'open' : ''} ${leftSidebarCollapsed ? 'collapsed' : ''}`}>
        {leftSidebarCollapsed ? (
          <button
            type="button"
            className="sidebar-expand-btn"
            onClick={() => setLeftSidebarCollapsed(false)}
            title="展开目录"
            aria-label="展开目录"
          >
            <ChevronRight size={16} />
          </button>
        ) : (
          <>
            <div className="sidebar-header">
              <span className="flex items-center gap-2">
                <BookOpen size={16} />
                目录
              </span>
              <button
                type="button"
                className="sidebar-close"
                onClick={() => mobileMode ? setShowSidebar(false) : setLeftSidebarCollapsed(true)}
                title="折叠目录"
                aria-label="折叠目录"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
            <div className="outline-list">
              {outline.length === 0 ? (
                <div className="outline-empty">暂无目录</div>
          ) : (
            outline.map((item) => (
              <div
                key={item.id}
                className={`outline-item level-${item.level} ${activeHeading === item.id ? 'active' : ''}`}
                onClick={() => setActiveHeading(item.id)}
              >
                <ChevronRight size={12} className="inline mr-1" />
                {item.text}
              </div>
            ))
              )}
            </div>
          </>
        )}
      </div>

      {showSidebar && (
        <div
          className="sidebar-backdrop"
          onClick={() => setShowSidebar(false)}
        />
      )}

      <div className="editor-main">
        <div className="editor-top-toolbar" role="toolbar" aria-label="编辑工具栏">
          <div className="toolbar-group">
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="加粗 (Ctrl+B)"
              aria-label="加粗"
              aria-pressed={editor.isActive('bold')}
            >
              <Bold size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="斜体 (Ctrl+I)"
              aria-label="斜体"
              aria-pressed={editor.isActive('italic')}
            >
              <Italic size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('underline') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title="下划线"
              aria-label="下划线"
              aria-pressed={editor.isActive('underline')}
            >
              <UnderlineIcon size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('strike') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title="删除线"
              aria-label="删除线"
              aria-pressed={editor.isActive('strike')}
            >
              <Strikethrough size={16} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              title="标题1"
              aria-label="标题 1"
              aria-pressed={editor.isActive('heading', { level: 1 })}
            >
              <Heading1 size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              title="标题2"
              aria-label="标题 2"
              aria-pressed={editor.isActive('heading', { level: 2 })}
            >
              <Heading2 size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              title="标题3"
              aria-label="标题 3"
              aria-pressed={editor.isActive('heading', { level: 3 })}
            >
              <Heading3 size={16} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="无序列表"
              aria-label="无序列表"
              aria-pressed={editor.isActive('bulletList')}
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="有序列表"
              aria-label="有序列表"
              aria-pressed={editor.isActive('orderedList')}
            >
              <ListOrdered size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('taskList') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              title="任务列表"
              aria-label="任务列表"
              aria-pressed={editor.isActive('taskList')}
            >
              <ListTodo size={16} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              title="引用"
              aria-label="引用"
              aria-pressed={editor.isActive('blockquote')}
            >
              <Quote size={16} />
            </button>
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('codeBlock') ? 'active' : ''}`}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              title="代码块"
              aria-label="代码块"
              aria-pressed={editor.isActive('codeBlock')}
            >
              <Code size={16} />
            </button>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              title="分隔线"
              aria-label="分割线"
            >
              <Minus size={16} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              type="button"
              className={`toolbar-btn ${editor.isActive('link') ? 'active' : ''}`}
              onClick={handleSetLink}
              title="链接"
              aria-label="插入链接"
              aria-pressed={editor.isActive('link')}
            >
              <Link2 size={16} />
            </button>
            <button
              type="button"
              className="toolbar-btn"
              onClick={addImage}
              title="图片"
              aria-label="插入图片"
            >
              <ImageIcon size={16} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => editor.chain().focus().undo().run()}
              title="撤销 (Ctrl+Z)"
              aria-label="撤销"
            >
              <Undo size={16} />
            </button>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => editor.chain().focus().redo().run()}
              title="重做 (Ctrl+Y)"
              aria-label="重做"
            >
              <Redo size={16} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <button
            type="button"
            className="toolbar-btn sidebar-toggle"
            onClick={() => setShowSidebar(true)}
            title="目录"
            aria-label="打开目录"
          >
            <Menu size={16} />
          </button>
        </div>

        <div className="editor-content-wrapper">
          {showTitleInput && (
            <input
              type="text"
              aria-label="文档标题"
              className="editor-title-input"
              value={title}
              onChange={handleTitleInputChange}
              placeholder="无标题文档"
            />
          )}
          <div className="editor-content" style={{ maxHeight }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <div className={`editor-sidebar right ${rightSidebarCollapsed ? 'collapsed' : ''}`}>
        {rightSidebarCollapsed ? (
            <button
              type="button"
              className="sidebar-expand-btn"
              onClick={() => setRightSidebarCollapsed(false)}
              title="展开AI助手"
              aria-label="展开 AI 助手"
          >
            <ChevronLeft size={16} />
          </button>
        ) : (
          <>
            <div className="sidebar-header">
              <span className="flex items-center gap-2">
                <Bot size={16} />
                AI 助手
              </span>
              <button
                type="button"
                className="sidebar-close"
                onClick={() => setRightSidebarCollapsed(true)}
                title="折叠AI助手"
                aria-label="折叠 AI 助手"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="ai-panel">
              <div className="ai-section">
                <h4 className="flex items-center gap-2">
                  <FileText size={12} />
                  文档信息
                </h4>
                <div className="ai-info-item">
                  <span>字数:</span>
                  <span>{editor.getText().length}</span>
                </div>
                <div className="ai-info-item">
                  <span>词数:</span>
                  <span>{editor.getText().split(/\s+/).filter(Boolean).length}</span>
                </div>
              </div>

              <div className="ai-section">
                <h4 className="flex items-center gap-2">
                  <Bot size={12} />
                  AI 功能
                </h4>
                <button className="ai-btn" onClick={() => setShowAIAssistant(!showAIAssistant)}>
                  {showAIAssistant ? '隐藏助手' : '显示助手'}
                </button>
                {showAIAssistant && (
                  <div className="ai-assistant">
                    <p>AI 助手功能即将上线...</p>
                  </div>
                )}
              </div>

              <div className="ai-section">
                <h4 className="flex items-center gap-2">
                  <ChevronRight size={12} />
                  快捷操作
                </h4>
                <button
                  className="ai-btn flex items-center justify-center gap-2"
                  onClick={() => editor.chain().focus().clearContent().run()}
                >
                  <Trash2 size={12} />
                  清空内容
                </button>
                <button
                  className="ai-btn flex items-center justify-center gap-2"
                  onClick={() => console.log(editor.getHTML())}
                >
                  <Download size={12} />
                  导出 HTML
                </button>
              </div>
            </div>
          </>
        )}
      </div>

          {showLinkModal && (
            <div className="link-modal-overlay" onClick={cancelLink}>
              <div
                className="link-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={linkDialogTitleId}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="link-modal-header">
                  <h3 id={linkDialogTitleId}>插入链接</h3>
                  <button
                    type="button"
                    className="link-modal-close"
                    onClick={cancelLink}
                    aria-label="关闭插入链接对话框"
                  >
                <X size={16} />
              </button>
            </div>
            <div className="link-modal-body">
                  <input
                    type="url"
                    aria-label="链接地址"
                    className="link-modal-input"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="请输入链接地址"
                autoFocus
              />
            </div>
            <div className="link-modal-footer">
                  <button type="button" className="link-modal-btn cancel" onClick={cancelLink}>
                取消
              </button>
                  <button type="button" className="link-modal-btn confirm" onClick={confirmLink}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
