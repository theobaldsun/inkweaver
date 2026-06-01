export interface EditorConfig {
  placeholder?: string;
  editable?: boolean;
  minHeight?: number;
  maxHeight?: number;
}

export interface EditorState {
  content: string;
  isDirty: boolean;
  isValid: boolean;
}

export interface EditorSelection {
  from: number;
  to: number;
}

export interface EditorNode {
  type: string;
  attrs?: Record<string, any>;
  content?: EditorNode[];
  text?: string;
}
