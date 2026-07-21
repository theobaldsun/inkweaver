/**
 * Yjs sync update 请求体校验。
 *
 * 用途：限制单次条数/体积，并验证 Base64 可解码为合法 Yjs update。
 * 输入：未知 updates 载荷；输出：通过断言或抛出 BadRequestException
 */

import { BadRequestException } from '@nestjs/common';
import * as Y from 'yjs';

export const MAX_SYNC_UPDATES_PER_REQUEST = 50;
export const MAX_SYNC_UPDATE_BYTES = 512 * 1024;
export const MAX_SYNC_UPDATE_BASE64_LENGTH = Math.ceil(MAX_SYNC_UPDATE_BYTES / 3) * 4;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function assertValidSyncUpdates(updates: unknown): asserts updates is string[] {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new BadRequestException('updates 必须包含至少一条变更');
  }
  if (updates.length > MAX_SYNC_UPDATES_PER_REQUEST) {
    throw new BadRequestException(`单次最多提交 ${MAX_SYNC_UPDATES_PER_REQUEST} 条变更`);
  }

  for (const update of updates) {
    if (
      typeof update !== 'string' ||
      update.length === 0 ||
      update.length > MAX_SYNC_UPDATE_BASE64_LENGTH ||
      update.length % 4 !== 0 ||
      !BASE64_PATTERN.test(update) ||
      Buffer.byteLength(update, 'base64') > MAX_SYNC_UPDATE_BYTES
    ) {
      throw new BadRequestException('同步更新必须是大小受限的 Base64 数据');
    }

    try {
      Y.decodeUpdate(Buffer.from(update, 'base64'));
    } catch {
      throw new BadRequestException('同步更新必须是有效的 Yjs update');
    }
  }
}
