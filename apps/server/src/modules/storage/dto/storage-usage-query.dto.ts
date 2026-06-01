/**
 * 存储用量查询 DTO。
 */

import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class StorageUsageQueryDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  recalculate?: boolean;
}
