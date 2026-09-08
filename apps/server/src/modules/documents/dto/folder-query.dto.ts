/** 文件夹查询 DTO。 */
import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';

export class FolderListQueryDto {
  @IsOptional()
  @IsUUID('4')
  parentId?: string;
}

export class DeleteFolderQueryDto {
  @IsOptional()
  @IsBooleanString()
  deleteAll?: string;
}
