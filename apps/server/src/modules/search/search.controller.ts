import { Controller, Get, Post, Delete, Query, Request, UseGuards } from "@nestjs/common";
import type { Request as ExpressRequest } from "express";
import { AuthGuard } from "../auth/guard/auth.guard";
import { SearchService } from "./search.service";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller("/api/search")
@ApiTags('search')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class SearchController {
  constructor(private searchService: SearchService) {}

  @ApiOperation({ summary: '获取搜索历史' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Get("/history")
  async getSearchHistory(
    @Request() req: ExpressRequest,
    @Query("limit") limit: number = 10,
  ) {
    const userId = (req.user as any)?.sub;
    const history = await this.searchService.getSearchHistory(userId, limit);
    return { history: history.map(h => ({ keyword: h.keyword, count: h.count, updatedAt: h.updatedAt })) };
  }

  @ApiOperation({ summary: '添加搜索历史' })
  @ApiResponse({ status: 200, description: '添加成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Post("/history")
  async addSearchHistory(
    @Request() req: ExpressRequest,
    @Query("keyword") keyword: string,
  ) {
    const userId = (req.user as any)?.sub;
    await this.searchService.addSearchHistory(userId, keyword);
    return { message: '添加成功' };
  }

  @ApiOperation({ summary: '删除单条搜索历史' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Delete("/history")
  async deleteSearchHistory(
    @Request() req: ExpressRequest,
    @Query("keyword") keyword: string,
  ) {
    const userId = (req.user as any)?.sub;
    await this.searchService.deleteSearchHistory(userId, keyword);
    return { message: '删除成功' };
  }

  @ApiOperation({ summary: '清空搜索历史' })
  @ApiResponse({ status: 200, description: '清空成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Delete("/history/all")
  async clearSearchHistory(@Request() req: ExpressRequest) {
    const userId = (req.user as any)?.sub;
    await this.searchService.clearSearchHistory(userId);
    return { message: '清空成功' };
  }
}