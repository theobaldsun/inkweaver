/**
 * `/uploads/*` 回源中间件：本地未命中时从 ObjectStorage（MinIO）读取。
 *
 * 输入：Express req/res/next
 * 输出：文件流或 next()
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ObjectStorageService } from './object-storage.service';
import type { NextFunction, Request, Response } from 'express';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * 创建 uploads 静态 + MinIO 回源中间件。
 * 输入：ObjectStorageService；输出：Express 中间件
 */
export function createUploadsMiddleware(objectStorage: ObjectStorageService) {
  const uploadsRoot = path.join(process.cwd(), 'uploads');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const relative = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (!relative || relative.includes('..')) {
      res.status(400).end();
      return;
    }

    const absolutePath = path.join(uploadsRoot, relative);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      res.sendFile(absolutePath, (err) => {
        if (err) next(err);
      });
      return;
    }

    const object = await objectStorage.getObject(relative);
    if (!object) {
      res.status(404).end();
      return;
    }

    const ext = path.extname(relative).toLowerCase();
    res.setHeader(
      'Content-Type',
      object.contentType || CONTENT_TYPES[ext] || 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).send(object.body);
  };
}
