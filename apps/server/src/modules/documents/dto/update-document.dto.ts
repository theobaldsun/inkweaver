/**
 * 更新文档请求 DTO
 */

import { IsString, IsBoolean, IsOptional, IsArray, MaxLength, MinLength } from 'class-validator';

export class UpdateDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(1_000_000)
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  folderId?: string;
}
