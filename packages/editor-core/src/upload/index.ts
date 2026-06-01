export type ImageUploader = (file: File | string) => Promise<string>;

export interface UploadOptions {
  maxSize?: number;
  allowedTypes?: string[];
  onProgress?: (progress: number) => void;
}

export interface UploadResult {
  url: string;
  filename: string;
  size: number;
}
