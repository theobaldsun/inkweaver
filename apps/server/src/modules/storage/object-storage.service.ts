/**
 * 对象存储抽象：本地磁盘或 MinIO（S3 兼容）。
 *
 * 用途：统一 put/get；对外 URL 仍为 `/uploads/{key}`。
 * 输入：相对 uploads 根的 object key（如 assets/u/a.png）
 * 输出：写入成功 / 读取 Buffer 或 null
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ObjectPutInput {
  key: string;
  body: Buffer;
  contentType: string;
}

/**
 * 将 `/uploads/...` 或相对路径规范为 object key（不含 uploads 前缀）。
 * 输入：URL 或相对路径；输出：key 或 null
 */
export function toObjectKey(uploadPath: string): string | null {
  const normalized = uploadPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const withoutPrefix = normalized.startsWith('uploads/')
    ? normalized.slice('uploads/'.length)
    : normalized;
  if (!withoutPrefix || withoutPrefix.includes('..')) return null;
  return withoutPrefix;
}

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly uploadsRoot: string;
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  readonly minioEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.uploadsRoot = path.join(process.cwd(), 'uploads');
    const endpoint = config.get<string>('MINIO_ENDPOINT')?.trim();
    this.minioEnabled = Boolean(endpoint);
    this.bucket = config.get<string>('MINIO_BUCKET', 'inkweaver');

    if (this.minioEnabled && endpoint) {
      const useSsl = config.get<string>('MINIO_USE_SSL', 'false') === 'true';
      const accessKey =
        config.get<string>('MINIO_ACCESS_KEY') ??
        config.get<string>('MINIO_ROOT_USER', '');
      const secretKey =
        config.get<string>('MINIO_SECRET_KEY') ??
        config.get<string>('MINIO_ROOT_PASSWORD', '');

      this.s3 = new S3Client({
        region: config.get<string>('MINIO_REGION', 'us-east-1'),
        endpoint: endpoint.startsWith('http')
          ? endpoint
          : `${useSsl ? 'https' : 'http'}://${endpoint}`,
        forcePathStyle: true,
        credentials: {
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
        },
      });
      this.logger.log(`Object storage: MinIO enabled bucket=${this.bucket}`);
    } else {
      this.s3 = null;
      this.logger.log('Object storage: local uploads directory');
    }
  }

  /**
   * 写入对象：MinIO 启用时写桶，否则写本地 uploads。
   */
  async putObject(input: ObjectPutInput): Promise<void> {
    const key = toObjectKey(input.key);
    if (!key) {
      throw new Error('非法对象 key');
    }

    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
      return;
    }

    const absolutePath = path.join(this.uploadsRoot, key);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.body);
  }

  /**
   * 读取对象：优先本地文件，其次 MinIO（兼容历史 uploads）。
   */
  async getObject(keyOrPath: string): Promise<{ body: Buffer; contentType?: string } | null> {
    const key = toObjectKey(keyOrPath);
    if (!key) return null;

    const absolutePath = path.join(this.uploadsRoot, key);
    try {
      const body = await fs.readFile(absolutePath);
      return { body };
    } catch {
      // fall through to MinIO
    }

    if (!this.s3) return null;

    try {
      const result = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      const body = await streamToBuffer(result.Body as Readable | undefined);
      if (!body) return null;
      return { body, contentType: result.ContentType };
    } catch (error) {
      this.logger.debug(`MinIO get miss key=${key}: ${String(error)}`);
      return null;
    }
  }

  /**
   * 幂等删除单个对象，同时清理本地历史文件与当前 MinIO 对象。
   * S3 DeleteObject 和本地 force 删除都允许目标不存在，便于注销失败后安全重试。
   */
  async deleteObject(keyOrPath: string): Promise<void> {
    const key = toObjectKey(keyOrPath);
    if (!key) throw new Error('非法对象 key');

    await fs.rm(path.join(this.uploadsRoot, key), { force: true });
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
  }

  /**
   * 幂等删除用户对象前缀。
   * 前缀必须至少包含一级目录，防止调用方误删整个 uploads 根或整个桶。
   */
  async deletePrefix(prefixOrPath: string): Promise<void> {
    const prefix = toObjectKey(prefixOrPath)?.replace(/\/+$/, '');
    if (!prefix || !prefix.includes('/')) {
      throw new Error('对象前缀范围过大');
    }

    await fs.rm(path.join(this.uploadsRoot, prefix), { recursive: true, force: true });
    if (!this.s3) return;

    while (true) {
      const listed = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${prefix}/`,
        }),
      );
      const objects = (listed.Contents ?? [])
        .map(({ Key }) => Key)
        .filter((Key): Key is string => Boolean(Key))
        .map((Key) => ({ Key }));
      if (objects.length > 0) {
        const deleted = await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
        if ((deleted.Errors?.length ?? 0) > 0) {
          throw new Error(`对象批量删除失败：${deleted.Errors!.length} 项`);
        }
      }
      // 始终重新读取首批：删除会改变列表，复用旧 continuation token 可能跳过对象。
      if (objects.length === 0) break;
    }
  }
}

/**
 * 将 S3 Body 流转为 Buffer。
 * 输入：Readable 或 undefined；输出：Buffer 或 null
 */
async function streamToBuffer(stream: Readable | undefined): Promise<Buffer | null> {
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
