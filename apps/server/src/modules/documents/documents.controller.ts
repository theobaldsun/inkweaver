/**
 * 文档控制器
 *
 * 用途：提供文档 CRUD 与回收站相关 HTTP 接口
 */

import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards, ParseUUIDPipe } from "@nestjs/common";


import { DocumentsService } from "./documents.service";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { DocumentListQueryDto, DocumentSearchQueryDto } from './dto/document-query.dto';
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { AuthGuard } from "../auth/guard/auth.guard";

import type { Request as ExpressRequest } from "express";

@Controller("/api/documents")
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post()
  async createDocument(@Request() req: ExpressRequest, @Body() createDocumentDto: CreateDocumentDto) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.createDocument(userId!, createDocumentDto);
  }

  @Get()
  async getDocuments(
    @Request() req: ExpressRequest,
    @Query() query: DocumentListQueryDto,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    const resolvedFolderId =
      query.folderId === undefined ? undefined : query.folderId === 'root' ? null : query.folderId;
    return this.documentsService.getDocuments(
      userId!,
      query.page,
      query.pageSize,
      query.sortBy,
      query.sortOrder,
      resolvedFolderId,
      query.filter,
    );
  }

  @Get("/search")
  async searchDocuments(
    @Request() req: ExpressRequest,
    @Query() query: DocumentSearchQueryDto,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.searchDocuments(userId!, query.keyword, query.page, query.pageSize);
  }

  @Get("/:docId")
  async getDocument(
    @Request() req: ExpressRequest,
    @Param("docId", ParseUUIDPipe) docId: string,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.getDocument(docId, userId!);
  }

  @Put("/:docId")
  async updateDocument(
    @Request() req: ExpressRequest,
    @Param("docId", ParseUUIDPipe) docId: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.updateDocument(docId, userId!, updateDocumentDto);
  }

  /** 移入回收站 */
  @Post('/:docId/share-link')
  async createShareLink(
    @Request() req: ExpressRequest,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.generateShareLink(docId, userId!);
  }

  @Delete("/:docId")
  async deleteDocument(
    @Request() req: ExpressRequest,
    @Param("docId", ParseUUIDPipe) docId: string,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    await this.documentsService.deleteDocument(docId, userId!);
    return { message: '已移入回收站' };
  }

  @Post("/:docId/restore")
  async restoreDocument(
    @Request() req: ExpressRequest,
    @Param("docId", ParseUUIDPipe) docId: string,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.restoreDocument(docId, userId!);
  }

  @Delete("/:docId/permanent")
  async permanentlyDeleteDocument(
    @Request() req: ExpressRequest,
    @Param("docId", ParseUUIDPipe) docId: string,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    await this.documentsService.permanentlyDeleteDocument(docId, userId!);
    return { message: '已永久删除' };
  }
}
