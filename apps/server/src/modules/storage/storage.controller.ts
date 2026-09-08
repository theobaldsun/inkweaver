/**
 * 存储控制器。
 *
 * 用途：提供标准化存储用量 API。
 */

import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { StorageUsageQueryDto } from './dto/storage-usage-query.dto';
import { StorageAssetService } from './storage-asset.service';
import { StorageUsageService } from './storage-usage.service';
import { AuthGuard } from '../auth/guard/auth.guard';

@Controller('/api/storage')
@ApiTags('storage')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class StorageController {
  constructor(
    private readonly storageUsageService: StorageUsageService,
    private readonly storageAssetService: StorageAssetService,
  ) {}

  /**
   * 获取当前用户存储用量（标准格式）。
   */
  @ApiOperation({ summary: '获取存储使用统计' })
  @ApiResponse({ status: 200, description: '成功' })
  @Get('/usage')
  async getUsage(@Request() req: { user?: { sub: string } }, @Query() query: StorageUsageQueryDto) {
    const userId = req.user?.sub;
    return this.storageUsageService.getUserStorageUsage(userId!, {
      recalculate: query.recalculate,
    });
  }

  /**
   * 强制重新计算存储用量。
   */
  @ApiOperation({ summary: '强制重新计算存储用量' })
  @Post('/usage/recalculate')
  async recalculate(@Request() req: { user?: { sub: string } }) {
    const userId = req.user?.sub;
    return this.storageUsageService.recalculateAndPersist(userId!);
  }

  /**
   * 上传文档内嵌图片等资源。
   */
  @ApiOperation({ summary: '上传资源文件' })
  @ApiConsumes('multipart/form-data')
  @Post('/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadAsset(
    @Request() req: { user?: { sub: string } },
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    if (!file) {
      throw new BadRequestException('请上传文件');
    }
    const userId = req.user?.sub;
    return this.storageAssetService.saveUserAsset(userId!, file);
  }
}
