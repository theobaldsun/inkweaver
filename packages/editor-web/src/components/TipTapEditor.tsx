import React, { useEffect, useRef }  from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { lowlight } from 'lowlight';
import type { EditorConfig, EditorChangeEvent } from '@inkweaver/editor-core';
import './TipTapEditor.css';

interface TipTapEditorProps extends EditorConfig {
  content: string;
  onChange: (event: EditorChangeEvent) => void;
  imageUploader?: (file: File) => Promise<string>;
}

export const TipTapEditor: React.FC<TipTapEditorProps> = ({
  content,
  onChange,
  placeholder = 'Start typing...',
  editable = true,
  minHeight = 600,
  maxHeight,
  imageUploader,
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
    ],
    content: content || '',
    editable,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none',
        style: minHeight ? `min-height: ${minHeight}px` : undefined,
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
  
  if (!editor) {
    return null;
  }

  return (
    <div className="tiptap-editor">
      <div className="editor-toolbar">
        <button
          className={`toolbar-button ${editor.isActive('bold') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor}
          title="Bold (Ctrl+B)"
        >
          加粗
        </button>
        <button
          className={`toolbar-button ${editor.isActive('italic') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor}
          title="Italic (Ctrl+I)"
        >
          I
        </button>
        <button
          className={`toolbar-button ${editor.isActive('strike') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor}
          title="Strikethrough (Ctrl+Shift+S)"
        >
          S
        </button>
        <div className="toolbar-separator" />
        <button
          className={`toolbar-button ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          disabled={!editor}
          title="Heading 1"
        >
          H1
        </button>
        <button
          className={`toolbar-button ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={!editor}
          title="Heading 2"
        >
          H2
        </button>
        <button
          className={`toolbar-button ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          disabled={!editor}
          title="Heading 3"
        >
          H3
        </button>
        <div className="toolbar-separator" />
        <button
          className={`toolbar-button ${editor.isActive('bulletList') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          disabled={!editor}
          title="Bullet List"
        >
          • List
        </button>
        <button
          className={`toolbar-button ${editor.isActive('orderedList') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={!editor}
          title="Ordered List"
        >
          1. List
        </button>
        <button
          className={`toolbar-button ${editor.isActive('taskList') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleList('taskList', 'taskItem').run()}
          disabled={!editor}
          title="Task List"
        >
          ✅ Task
        </button>
        <div className="toolbar-separator" />
        <button
          className={`toolbar-button ${editor.isActive('blockquote') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          disabled={!editor}
          title="Blockquote"
        >
          ""
        </button>
        <button
          className="toolbar-button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          disabled={!editor}
          title="Horizontal Rule"
        >
          ─
        </button>
        <div className="toolbar-separator" />
        <button
          className={`toolbar-button ${editor.isActive('codeBlock') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          disabled={!editor}
          title="Code Block"
        >
          Code
        </button>
        <div className="toolbar-separator" />
        <button
          className="toolbar-button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          className="toolbar-button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
      </div>
      <div className="editor-content" style={{ maxHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
