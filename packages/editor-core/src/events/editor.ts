export interface EditorChangeEvent {
  content: string;
  html: string;
  text: string;
  wordCount: number;
  charCount: number;
}

export interface EditorSaveEvent {
  content: string;
  timestamp: number;
  version: number;
}

export interface EditorFocusEvent {
  focused: boolean;
  selection?: {
    from: number;
    to: number;
  };
}

export interface EditorUploadEvent {
  file: File | string;
  progress: number;
  url?: string;
  error?: string;
}
