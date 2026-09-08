/**
 * 回收站控制器
 *
 * 用途：独立挂载在 /api/documents/trash，避免与 /:docId 动态路由冲突
 * 输入：分页查询参数、认证用户
 * 输出：回收站列表或清空结果
 */

import { Controller, Delete, Get, Query, Request, UseGuards } from "@nestjs/common";

import { DocumentsService } from "./documents.service";
import { TrashListQueryDto } from './dto/document-query.dto';
import { AuthGuard } from "../auth/guard/auth.guard";

import type { Request as ExpressRequest } from "express";

@Controller("/api/documents/trash")
@UseGuards(AuthGuard)
export class DocumentsTrashController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * 回收站列表
   * @param page 页码，默认 1
   * @param pageSize 每页条数，默认 20（服务层会 clamp 到 1~100）
   */
  @Get()
  async getTrashDocuments(
    @Request() req: ExpressRequest,
    @Query() query: TrashListQueryDto,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.getTrashDocuments(userId!, query.page, query.pageSize);
  }

  /**
   * 清空当前用户回收站
   */
  @Delete()
  async emptyTrash(@Request() req: ExpressRequest) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.emptyTrash(userId!);
  }
}
