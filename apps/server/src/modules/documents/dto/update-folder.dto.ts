import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateFolderDto {
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1)
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  @IsOptional()
  parentId?: string | null;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;
}
