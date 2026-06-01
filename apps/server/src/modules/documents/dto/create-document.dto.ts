/**
 * 创建文档请求 DTO
 */

import { IsString, IsBoolean, IsOptional, IsArray } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  folderId?: string;
}
