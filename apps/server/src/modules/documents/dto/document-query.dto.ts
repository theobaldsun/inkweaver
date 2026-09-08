/**
 * 文档列表与搜索查询 DTO。
 * 在 HTTP 边界完成类型转换和范围校验，Service 仍保留 clamp 作为纵深防御。
 */
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
}

export class DocumentListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'title'])
  sortBy: 'updatedAt' | 'createdAt' | 'title' = 'updatedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @ValidateIf((_object, value) => value !== 'root')
  @IsUUID('4')
  folderId?: string;

  @IsOptional()
  @IsIn(['all', 'recent', 'mine', 'public'])
  filter: 'all' | 'recent' | 'mine' | 'public' = 'all';
}

export class DocumentSearchQueryDto extends PaginationQueryDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  keyword!: string;
}

export class TrashListQueryDto extends PaginationQueryDto {
  pageSize = 20;
}
