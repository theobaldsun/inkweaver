/**
 * 用户资源文件上传（文档图片等）。
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { StorageUsageService } from './storage-usage.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class StorageAssetService {
  constructor(private readonly storageUsageService: StorageUsageService) {}

  /**
   * 保存用户上传的图片资源。
   * @returns 可访问的相对 URL（/uploads/assets/...）
   */
  async saveUserAsset(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ url: string }> {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('仅支持 JPEG、PNG、WebP、GIF 图片');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('图片不能超过 5MB');
    }

    const ext =
      file.mimetype === 'image/png'
        ? 'png'
        : file.mimetype === 'image/webp'
          ? 'webp'
          : file.mimetype === 'image/gif'
            ? 'gif'
            : 'jpg';

    const dir = path.join(process.cwd(), 'uploads', 'assets', userId);
    await fs.mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.${ext}`;
    await fs.writeFile(path.join(dir, filename), file.buffer);

    this.storageUsageService.scheduleRecalculate(userId);

    return { url: `/uploads/assets/${userId}/${filename}` };
  }
}
