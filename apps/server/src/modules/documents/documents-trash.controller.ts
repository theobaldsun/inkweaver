/**
 * 回收站控制器
 *
 * 用途：独立挂载在 /api/documents/trash，避免与 /:docId 动态路由冲突
 * 输入：分页查询参数、认证用户
 * 输出：回收站列表或清空结果
 */

import { Controller, Delete, Get, Query, Request, UseGuards } from "@nestjs/common";
import type { Request as ExpressRequest } from "express";
import { AuthGuard } from "../auth/guard/auth.guard";
import { DocumentsService } from "./documents.service";

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
    @Query("page") page: number = 1,
    @Query("pageSize") pageSize: number = 20,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.getTrashDocuments(userId!, Number(page), Number(pageSize));
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
