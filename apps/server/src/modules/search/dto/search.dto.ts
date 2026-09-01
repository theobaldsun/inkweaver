// search.dto.ts
import { Transform, Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsIn, IsInt, Min, Max, MaxLength, IsOptional, IsUUID } from 'class-validator';

export class SearchHybridDto {
  /** 搜索关键词（非空，最长 200 字符） */
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value?.trim() : value)
  @IsNotEmpty({ message: '搜索关键词不能为空' })
  @MaxLength(200, { message: '搜索关键词不能超过 200 字符' })
  q!: string;

  /** 搜索模式：smart（四路融合）/ keyword（精确+全文）/ semantic（精确+语义） */
  @IsOptional()
  @IsIn(['smart', 'keyword', 'semantic'], { message: 'mode 必须是 smart/keyword/semantic' })
  mode: 'smart' | 'keyword' | 'semantic' = 'smart';

  /** 页码（≥1） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  @Min(1)
  @Max(10000)
  page: number = 1;

  /** 每页数量（1~100） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须是整数' })
  @Min(1)
  @Max(100)
  pageSize: number = 10;

  /** 可选：按文件夹过滤（UUID） */
  @IsOptional()
  @IsUUID('4', { message: 'folderId 必须是合法 UUID' })
  folderId?: string;
}
