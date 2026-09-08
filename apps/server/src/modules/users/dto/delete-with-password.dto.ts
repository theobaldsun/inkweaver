import { PASSWORD_DIGEST_REGEX } from '@inkweaver/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

const DIGEST_MESSAGE = '必须为 SHA-256 十六进制摘要（64 位），禁止提交明文密码';

export class DeleteWithPasswordDto {
  @IsString()
  @Matches(PASSWORD_DIGEST_REGEX, { message: `密码${DIGEST_MESSAGE}` })
  @ApiProperty({
    description: '当前密码 SHA-256 摘要（客户端计算）',
    example: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f',
  })
  passwordHash!: string;
}
