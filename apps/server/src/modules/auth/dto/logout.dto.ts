import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LogoutDto {
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ description: '用户 ID' })
  userId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: '刷新令牌，用于撤销当前会话' })
  refresh_token?: string;
}
