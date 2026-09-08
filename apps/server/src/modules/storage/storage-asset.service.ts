/**
 * 用户资源文件上传（文档图片等）。
 *
 * 用途：校验图片魔数后写入 ObjectStorage（本地或 MinIO）。
 * 输入：userId + 文件缓冲；输出：相对 URL `/uploads/assets/...`
 */

import { randomUUID } from 'crypto';

import { BadRequestException, Injectable } from '@nestjs/common';

import { ObjectStorageService } from './object-storage.service';
import { StorageUsageService } from './storage-usage.service';
import { matchesImageSignature } from '../../common/image-signature';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class StorageAssetService {
  constructor(
    private readonly storageUsageService: StorageUsageService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

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
    if (!file.buffer || file.buffer.length === 0 || file.size <= 0) {
      throw new BadRequestException('上传内容不能为空');
    }
    if (file.size > MAX_BYTES || file.buffer.length > MAX_BYTES) {
      throw new BadRequestException('图片不能超过 5MB');
    }
    if (!matchesImageSignature(file.mimetype, file.buffer)) {
      throw new BadRequestException('上传内容与图片类型不匹配');
    }

    const ext =
      file.mimetype === 'image/png'
        ? 'png'
        : file.mimetype === 'image/webp'
          ? 'webp'
          : file.mimetype === 'image/gif'
            ? 'gif'
            : 'jpg';

    const filename = `${randomUUID()}.${ext}`;
    const key = `assets/${userId}/${filename}`;
    await this.objectStorage.putObject({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    this.storageUsageService.scheduleRecalculate(userId);

    return { url: `/uploads/${key}` };
  }
}
