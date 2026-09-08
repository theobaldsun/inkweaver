import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsUUID('4')
  @IsOptional()
  parentId?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;
}
