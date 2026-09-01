import { Controller, Get, Post, Delete, Query, Request, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { SearchHybridDto } from "./dto/search.dto";
import { SearchService } from "./search.service";
import { AuthGuard } from "../auth/guard/auth.guard";

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
    @Request() req: { user?: { sub: string } },
    @Query("limit") limit: number = 10,
  ) {
    const userId = req.user!.sub;
    const history = await this.searchService.getSearchHistory(userId, limit);
    return {
      history: history.map((h) => ({
        keyword: h.keyword,
        count: h.count,
        updatedAt: h.updatedAt,
        mode: h.mode || 'smart',
      })),
    };
  }

  @ApiOperation({ summary: '添加搜索历史' })
  @ApiResponse({ status: 200, description: '添加成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Post("/history")
  async addSearchHistory(
    @Request() req: { user?: { sub: string } },
    @Query("keyword") keyword: string,
    @Query("mode") mode: 'smart' | 'keyword' | 'semantic' = 'smart',
  ) {
    const userId = req.user!.sub;
    await this.searchService.addSearchHistory(userId, keyword, mode);
    return { message: '添加成功' };
  }

  @ApiOperation({ summary: '删除单条搜索历史' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Delete("/history")
  async deleteSearchHistory(
    @Request() req: { user?: { sub: string } },
    @Query("keyword") keyword: string,
  ) {
    const userId = req.user!.sub;
    await this.searchService.deleteSearchHistory(userId, keyword);
    return { message: '删除成功' };
  }

  @ApiOperation({ summary: '混合检索文档（四路融合）' })
  @ApiResponse({ status: 200, description: '检索成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Get("/hybrid")
  async hybridSearch(
    @Request() req: { user?: { sub: string } },
    @Query() query: SearchHybridDto
  ) {
    const userId = req.user!.sub;
    return this.searchService.hybridSearch(userId, query.q, Number(query.page), Number(query.pageSize), query.mode);
  }

  @ApiOperation({ summary: '清空搜索历史' })
  @ApiResponse({ status: 200, description: '清空成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Delete("/history/all")
  async clearSearchHistory(@Request() req: { user?: { sub: string } }) {
    const userId = req.user!.sub;
    await this.searchService.clearSearchHistory(userId);
    return { message: '清空成功' };
  }
}
