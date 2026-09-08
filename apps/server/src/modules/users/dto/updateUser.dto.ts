import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from "class-validator";

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @ApiProperty({ description: '昵称', required: false })
  name?: string;
}