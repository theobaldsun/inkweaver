/**
 * 文档公开访问接口（无需鉴权）。
 */

import { Controller, Get, Param } from '@nestjs/common';

import { DocumentsService } from './documents.service';

@Controller('/api/documents')
export class DocumentsPublicController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('/shared/:token')
  async getShared(@Param('token') token: string) {
    return this.documentsService.getDocumentByShareToken(token);
  }
}
