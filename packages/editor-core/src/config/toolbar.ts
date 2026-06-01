export interface ToolbarButton {
  id: string;
  icon?: string;
  label?: string;
  command: string;
  shortcut?: string;
  isActive?: () => boolean;
  isDisabled?: () => boolean;
}

export interface ToolbarConfig {
  buttons: ToolbarButton[];
  position?: 'top' | 'bottom' | 'floating';
  sticky?: boolean;
}

export const defaultToolbarConfig: ToolbarConfig = {
  buttons: [
    { id: 'bold', command: 'toggleBold', label: 'Bold', shortcut: 'Ctrl+B' },
    { id: 'italic', command: 'toggleItalic', label: 'Italic', shortcut: 'Ctrl+I' },
    { id: 'strike', command: 'toggleStrike', label: 'Strike', shortcut: 'Ctrl+Shift+S' },
    { id: 'heading1', command: 'toggleHeading', label: 'H1' },
    { id: 'heading2', command: 'toggleHeading', label: 'H2' },
    { id: 'heading3', command: 'toggleHeading', label: 'H3' },
    { id: 'bulletList', command: 'toggleBulletList', label: 'Bullet List' },
    { id: 'orderedList', command: 'toggleOrderedList', label: 'Ordered List' },
    { id: 'blockquote', command: 'toggleBlockquote', label: 'Quote' },
    { id: 'codeBlock', command: 'toggleCodeBlock', label: 'Code' },
    { id: 'undo', command: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
    { id: 'redo', command: 'redo', label: 'Redo', shortcut: 'Ctrl+Y' },
  ],
  position: 'top',
  sticky: true,
};
