/**
 * 文档控制器
 *
 * 用途：提供文档 CRUD 与回收站相关 HTTP 接口
 */

import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import type { Request as ExpressRequest } from "express";
import { AuthGuard } from "../auth/guard/auth.guard";

import { DocumentsService } from "./documents.service";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";

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
    @Query("page") page: number = 1,
    @Query("pageSize") pageSize: number = 10,
    @Query("sortBy") sortBy: string = 'updatedAt',
    @Query("sortOrder") sortOrder: 'ASC' | 'DESC' = 'DESC',
    @Query("folderId") folderId?: string,
    @Query("filter") filter?: 'all' | 'recent' | 'mine' | 'public',
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    const resolvedFolderId =
      folderId === undefined ? undefined : folderId === 'root' || folderId === '' ? null : folderId;
    return this.documentsService.getDocuments(
      userId!,
      Number(page),
      Number(pageSize),
      sortBy,
      sortOrder,
      resolvedFolderId,
      filter ?? 'all',
    );
  }

  @Get("/search")
  async searchDocuments(
    @Request() req: ExpressRequest,
    @Query("keyword") keyword: string,
    @Query("page") page: number = 1,
    @Query("pageSize") pageSize: number = 10,
  ) {
    const userId = (req.user as { sub?: string })?.sub;
    return this.documentsService.searchDocuments(userId!, keyword, Number(page), Number(pageSize));
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
