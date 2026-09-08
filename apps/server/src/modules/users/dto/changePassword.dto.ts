import { PASSWORD_DIGEST_REGEX } from '@inkweaver/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

const DIGEST_MESSAGE = '必须为 SHA-256 十六进制摘要（64 位），禁止提交明文密码';

export class ChangePasswordDto {
  @IsString()
  @Matches(PASSWORD_DIGEST_REGEX, { message: `旧密码${DIGEST_MESSAGE}` })
  @ApiProperty({
    description: '旧密码 SHA-256 摘要（客户端计算，非明文）',
    example: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f',
  })
  oldPasswordHash!: string;

  @IsString()
  @Matches(PASSWORD_DIGEST_REGEX, { message: `新密码${DIGEST_MESSAGE}` })
  @ApiProperty({
    description: '新密码 SHA-256 摘要（客户端计算，非明文）',
    example: '15e2b0d3c33891ebb0f1ef609ec41992075a3e1c974e923adac81161b00e86c1',
  })
  newPasswordHash!: string;
}
