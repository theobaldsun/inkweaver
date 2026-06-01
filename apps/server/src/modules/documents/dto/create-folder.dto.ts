import { IsString, IsOptional } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsString()
  @IsOptional()
  description?: string;
}