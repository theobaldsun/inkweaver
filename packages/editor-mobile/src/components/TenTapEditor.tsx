import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import type { EditorConfig, EditorChangeEvent } from '@inkweaver/editor-core';

interface TenTapEditorProps extends EditorConfig {
  content: string;
  onChange: (event: EditorChangeEvent) => void;
  height?: number;
  imageUploader?: (file: string) => Promise<string>;
}

export const TenTapEditor: React.FC<TenTapEditorProps> = ({
  content,
  onChange,
  placeholder = 'Start typing...',
  editable = true,
  minHeight = 600,
  height,
  imageUploader,
}) => {
  const webViewRef = useRef<WebView>(null);

  const getEditorHtml = () => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <script src="https://cdn.jsdelivr.net/npm/@tiptap/core@2.27.2/dist/index.umd.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@tiptap/starter-kit@2.27.2/dist/index.umd.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@tiptap/extension-code-block-lowlight@2.27.2/dist/index.umd.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lowlight@2.9.0/lib/core.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lowlight@2.9.0/lib/common.min.js"></script>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 16px;
            line-height: 1.5;
            color: #1e293b;
            background-color: #ffffff;
            padding: 16px;
            min-height: 100vh;
          }
          .tiptap-editor {
            border: 1px solid #e2e8f0;
            border-radius: 0.375rem;
            overflow: hidden;
            height: 100%;
          }
          .editor-toolbar {
            display: flex;
            align-items: center;
            padding: 0.5rem;
            background-color: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            flex-wrap: wrap;
            gap: 0.25rem;
            position: sticky;
            top: 0;
            z-index: 10;
          }
          .toolbar-button {
            padding: 0.25rem 0.5rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.25rem;
            background-color: #ffffff;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s ease;
            min-width: 32px;
          }
          .toolbar-button:hover {
            background-color: #f1f5f9;
            border-color: #cbd5e1;
          }
          .toolbar-button.active {
            background-color: #3b82f6;
            color: #ffffff;
            border-color: #3b82f6;
          }
          .toolbar-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .toolbar-separator {
            width: 1px;
            height: 1.5rem;
            background-color: #e2e8f0;
            margin: 0 0.5rem;
          }
          .editor-toolbar {
            display: flex;
            align-items: center;
            padding: 0.5rem;
            background-color: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            flex-wrap: wrap;
            gap: 0.25rem;
            position: sticky;
            top: 0;
            z-index: 10;
          }
          .toolbar-button {
            padding: 0.25rem 0.5rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.25rem;
            background-color: #ffffff;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s ease;
            min-width: 32px;
          }
          .toolbar-button:hover {
            background-color: #f1f5f9;
            border-color: #cbd5e1;
          }
          .toolbar-button.active {
            background-color: #3b82f6;
            color: #ffffff;
            border-color: #3b82f6;
          }
          .toolbar-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .toolbar-separator {
            width: 1px;
            height: 1.5rem;
            background-color: #e2e8f0;
            margin: 0 0.5rem;
          }
          .editor-content {
            padding: 1rem;
            min-height: ${minHeight}px;
            background-color: #ffffff;
          }
          .ProseMirror {
            outline: none;
          }
          .ProseMirror p {
            margin: 0 0 1rem 0;
          }
          .ProseMirror h1 {
            font-size: 2rem;
            font-weight: 700;
            margin: 1.5rem 0 1rem 0;
            color: #0f172a;
          }
          .ProseMirror h2 {
            font-size: 1.5rem;
            font-weight: 600;
            margin: 1.25rem 0 0.75rem 0;
            color: #0f172a;
          }
          .ProseMirror h3 {
            font-size: 1.25rem;
            font-weight: 600;
            margin: 1rem 0 0.5rem 0;
            color: #0f172a;
          }
          .ProseMirror ul,
          .ProseMirror ol {
            margin: 0 0 1rem 0;
            padding-left: 1.5rem;
          }
          .ProseMirror li {
            margin: 0.25rem 0;
          }
          .ProseMirror blockquote {
            border-left: 4px solid #e2e8f0;
            padding-left: 1rem;
            margin: 0 0 1rem 0;
            color: #64748b;
          }
          .ProseMirror code {
            background-color: #f1f5f9;
            padding: 0.125rem 0.25rem;
            border-radius: 0.25rem;
            font-family: 'Courier New', Courier, monospace;
            font-size: 0.875rem;
          }
          .ProseMirror pre {
            background-color: #1e293b;
            color: #f8fafc;
            padding: 1rem;
            border-radius: 0.375rem;
            overflow-x: auto;
            margin: 0 0 1rem 0;
          }
          .ProseMirror pre code {
            background-color: transparent;
            padding: 0;
            color: inherit;
          }
          .ProseMirror hr {
            border: none;
            border-top: 1px solid #e2e8f0;
            margin: 1.5rem 0;
          }
          .ProseMirror a {
            color: #3b82f6;
            text-decoration: underline;
          }
          .ProseMirror a:hover {
            color: #2563eb;
          }
        </style>
      </head>
      <body>
        <div class="tiptap-editor">
          <div class="editor-toolbar">
            <button class="toolbar-button" data-command="toggleBold" title="Bold (Ctrl+B)">加粗</button>
            <button class="toolbar-button" data-command="toggleItalic" title="Italic (Ctrl+I)">I</button>
            <button class="toolbar-button" data-command="toggleStrike" title="Strikethrough (Ctrl+Shift+S)">S</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-button" data-command="toggleHeading1" title="Heading 1">H1</button>
            <button class="toolbar-button" data-command="toggleHeading2" title="Heading 2">H2</button>
            <button class="toolbar-button" data-command="toggleHeading3" title="Heading 3">H3</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-button" data-command="toggleBulletList" title="Bullet List">• List</button>
            <button class="toolbar-button" data-command="toggleOrderedList" title="Ordered List">1. List</button>
            <button class="toolbar-button" data-command="toggleTaskList" title="Task List">✅ Task</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-button" data-command="toggleBlockquote" title="Blockquote">""</button>
            <button class="toolbar-button" data-command="setHorizontalRule" title="Horizontal Rule">─</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-button" data-command="toggleCodeBlock" title="Code Block">Code</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-button" data-command="undo" title="Undo (Ctrl+Z)">Undo</button>
            <button class="toolbar-button" data-command="redo" title="Redo (Ctrl+Y)">Redo</button>
          </div>
          <div class="editor-content" id="editor"></div>
        </div>
        <script>
          const { Editor } = window.TiptapCore;
          const StarterKit = window.TiptapStarterKit;
          const CodeBlockLowlight = window.TiptapExtensionCodeBlockLowlight;
          const { lowlight } = window.lowlight;
          
          let editor;
          
          function initEditor() {
            editor = new Editor({
              element: document.getElementById('editor'),
              extensions: [
                StarterKit.configure({
                  codeBlock: false,
                }),
                CodeBlockLowlight.configure({
                  lowlight,
                }),
              ],
              content: \`${content.replace(/`/g, '\\`')}\`,
              editable: ${editable},
              onUpdate: ({ editor }) => {
                const html = editor.getHTML();
                const text = editor.getText();
                const wordCount = text.split(/\\s+/).filter(Boolean).length;
                const charCount = text.length;
                
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  content: html,
                  html,
                  text,
                  wordCount,
                  charCount,
                }));
              },
            });
            
            // Add toolbar button event listeners
            document.querySelectorAll('.toolbar-button').forEach(button => {
              button.addEventListener('click', function() {
                const command = this.getAttribute('data-command');
                if (editor) {
                  switch (command) {
                    case 'toggleBold':
                      editor.chain().focus().toggleBold().run();
                      break;
                    case 'toggleItalic':
                      editor.chain().focus().toggleItalic().run();
                      break;
                    case 'toggleStrike':
                      editor.chain().focus().toggleStrike().run();
                      break;
                    case 'toggleHeading1':
                      editor.chain().focus().toggleHeading({ level: 1 }).run();
                      break;
                    case 'toggleHeading2':
                      editor.chain().focus().toggleHeading({ level: 2 }).run();
                      break;
                    case 'toggleHeading3':
                      editor.chain().focus().toggleHeading({ level: 3 }).run();
                      break;
                    case 'toggleBulletList':
                      editor.chain().focus().toggleBulletList().run();
                      break;
                    case 'toggleOrderedList':
                      editor.chain().focus().toggleOrderedList().run();
                      break;
                    case 'toggleTaskList':
                      editor.chain().focus().toggleList('taskList', 'taskItem').run();
                      break;
                    case 'toggleBlockquote':
                      editor.chain().focus().toggleBlockquote().run();
                      break;
                    case 'setHorizontalRule':
                      editor.chain().focus().setHorizontalRule().run();
                      break;
                    case 'toggleCodeBlock':
                      editor.chain().focus().toggleCodeBlock().run();
                      break;
                    case 'undo':
                      editor.chain().focus().undo().run();
                      break;
                    case 'redo':
                      editor.chain().focus().redo().run();
                      break;
                  }
                }
              });
            });
            
            // Update toolbar button states
            editor.on('update', () => {
              document.querySelectorAll('.toolbar-button').forEach(button => {
                const command = button.getAttribute('data-command');
                let isActive = false;
                
                switch (command) {
                  case 'toggleBold':
                    isActive = editor.isActive('bold');
                    break;
                  case 'toggleItalic':
                    isActive = editor.isActive('italic');
                    break;
                  case 'toggleStrike':
                    isActive = editor.isActive('strike');
                    break;
                  case 'toggleHeading1':
                    isActive = editor.isActive('heading', { level: 1 });
                    break;
                  case 'toggleHeading2':
                    isActive = editor.isActive('heading', { level: 2 });
                    break;
                  case 'toggleHeading3':
                    isActive = editor.isActive('heading', { level: 3 });
                    break;
                  case 'toggleBulletList':
                    isActive = editor.isActive('bulletList');
                    break;
                  case 'toggleOrderedList':
                    isActive = editor.isActive('orderedList');
                    break;
                  case 'toggleTaskList':
                    isActive = editor.isActive('taskList');
                    break;
                  case 'toggleBlockquote':
                    isActive = editor.isActive('blockquote');
                    break;
                  case 'toggleCodeBlock':
                    isActive = editor.isActive('codeBlock');
                    break;
                }
                
                if (isActive) {
                  button.classList.add('active');
                } else {
                  button.classList.remove('active');
                }
              });
            });
          }
          
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initEditor);
          } else {
            initEditor();
          }
          
          window.addEventListener('message', function(event) {
            const message = event.data;
            if (message.type === 'setContent') {
              if (editor) {
                editor.commands.setContent(message.content);
              }
            }
          });
        </script>
      </body>
      </html>
    `;
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      onChange(data);
    } catch (error) {
      console.error('Failed to parse editor message:', error);
    }
  };

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'setContent',
        content: content,
      }));
    }
  }, [content]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { height: height || minHeight }]}>
        <View style={styles.webWarning}>
          <Text style={styles.warningText}>
            Web platform should use @inkweaver/editor-web
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: height || minHeight }]}>
      <WebView
        ref={webViewRef}
        source={{ html: getEditorHtml() }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scalesPageToFit={true}
        style={styles.webview}
        originWhitelist={['*']}
        mixedContentMode="always"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
  },
  webWarning: {
    padding: 16,
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fcd34d',
  },
  warningText: {
    fontSize: 14,
    color: '#92400e',
  },
});
