import { Controller, Get, Post, Put, Delete, Body, Param, ParseUUIDPipe, Query, Request, UseGuards } from "@nestjs/common";


import { CreateFolderDto } from "./dto/create-folder.dto";
import { DeleteFolderQueryDto, FolderListQueryDto } from './dto/folder-query.dto';
import { UpdateFolderDto } from "./dto/update-folder.dto";
import { FoldersService } from "./folders.service";
import { getUserId } from '../../common/get-user-id';
import { AuthGuard } from "../auth/guard/auth.guard";

import type { Request as ExpressRequest } from "express";

@Controller("/api/folders")
@UseGuards(AuthGuard)
export class FoldersController {
  constructor(private foldersService: FoldersService) {}

  @Post()
  async createFolder(@Request() req: ExpressRequest, @Body() createFolderDto: CreateFolderDto) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.foldersService.createFolder(userId, createFolderDto);
  }

  @Get()
  async getFolders(
    @Request() req: ExpressRequest,
    @Query() query: FolderListQueryDto,
  ) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.foldersService.getFolders(userId, query.parentId);
  }

  @Get("/tree")
  async getFolderTree(@Request() req: ExpressRequest) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.foldersService.getFolderTree(userId);
  }

  @Get("/:folderId")
  async getFolder(@Request() req: ExpressRequest, @Param("folderId", ParseUUIDPipe) folderId: string) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.foldersService.getFolder(folderId, userId);
  }

  @Put("/:folderId")
  async updateFolder(
    @Request() req: ExpressRequest,
    @Param("folderId", ParseUUIDPipe) folderId: string,
    @Body() updateFolderDto: UpdateFolderDto,
  ) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.foldersService.updateFolder(folderId, userId, updateFolderDto);
  }

  @Delete("/:folderId")
  async deleteFolder(
    @Request() req: ExpressRequest, 
    @Param("folderId", ParseUUIDPipe) folderId: string,
    @Query() query: DeleteFolderQueryDto,
  ) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    const shouldDeleteAll = query.deleteAll === undefined ? true : query.deleteAll === "true";
    return this.foldersService.deleteFolder(folderId, userId, shouldDeleteAll);
  }
}
