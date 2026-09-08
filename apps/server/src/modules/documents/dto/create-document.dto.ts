/**
 * 创建文档请求 DTO
 */

import { IsString, IsBoolean, IsOptional, IsArray, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(1_000_000)
  content!: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @IsOptional()
  tags?: string[];

  @IsUUID()
  @IsOptional()
  folderId?: string;
}
