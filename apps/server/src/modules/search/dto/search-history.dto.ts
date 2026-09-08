/** 搜索历史查询 DTO。 */
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SearchHistoryLimitDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;
}

export class SearchHistoryKeywordDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  keyword!: string;
}

export class AddSearchHistoryDto extends SearchHistoryKeywordDto {
  @IsOptional()
  @IsIn(['smart', 'keyword', 'semantic'])
  mode: 'smart' | 'keyword' | 'semantic' = 'smart';
}
