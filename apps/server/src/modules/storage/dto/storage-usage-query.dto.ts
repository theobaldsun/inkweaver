/**
 * 存储用量查询 DTO。
 */

import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class StorageUsageQueryDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  recalculate?: boolean;
}
