/**
 * 同步 push DTO。
 *
 * 用途：
 * - 为客户端 push 变更提供输入校验契约
 *
 * 输入：HTTP 请求 body（JSON）
 * 输出：经过验证/转换的 DTO 实例（ValidationPipe）
 */

import { ArrayMaxSize, IsArray, IsBase64, IsString, IsNumber, IsOptional, MaxLength, Min, Max } from "class-validator";

import { MAX_SYNC_UPDATE_BASE64_LENGTH, MAX_SYNC_UPDATES_PER_REQUEST } from '../sync-update.validation';

export class PushDto {
  @IsString()
  docId!: string;

  @IsArray()
  @ArrayMaxSize(MAX_SYNC_UPDATES_PER_REQUEST)
  @IsString({ each: true })
  @IsBase64({}, { each: true })
  @MaxLength(MAX_SYNC_UPDATE_BASE64_LENGTH, { each: true })
  updates!: string[]; // Base64 编码的 Yjs updates

  @IsOptional()
  @IsString()
  clientId?: string; // 客户端ID，用于追踪更新来源

  /** 客户端已确认的最新 update_id，用于冲突检测 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseUpdateId?: number;
}

/**
 * 同步 pull DTO。
 */
export class PullDto {
  @IsString()
  docId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cursor?: number; // 游标，表示客户端最后收到的 update_id

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number; // 每次拉取的最大更新数量

  @IsOptional()
  @IsNumber()
  @Min(0)
  snapshotVersion?: number; // 客户端快照版本，用于判断是否需要返回快照
}

/**
 * 拉取响应 DTO
 */
export class PullResponseDto {
  snapshot?: string; // Base64 编码的文档快照
  snapshotVersion?: number; // snapshot 对应的最新 update_id
  updates!: string[]; // Base64 编码的 Yjs updates
  nextCursor!: number; // 下一次拉取的游标
  hasMore!: boolean; // 是否还有更多数据
  latestUpdateId!: number; // 服务端最新的 update_id
}
