/**
 * AI 问答请求 DTO。
 */

import { IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  question!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  docIds?: string[];
}
