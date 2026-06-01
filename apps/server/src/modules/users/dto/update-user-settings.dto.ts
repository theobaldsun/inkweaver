import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  browserNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  docUpdateNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  showOnlineStatus?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  allowDocSharing?: boolean;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  editorFontFamily?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  editorFontSize?: string;
}
