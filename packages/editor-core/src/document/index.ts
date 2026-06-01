export interface Document {
  id: string;
  title: string;
  content: string;
  html: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  author: string;
  tags?: string[];
}

export interface DocumentMetadata {
  wordCount: number;
  charCount: number;
  paragraphCount: number;
  readingTime: number;
}
