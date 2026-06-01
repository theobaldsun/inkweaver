import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards } from "@nestjs/common";
import type { Request as ExpressRequest } from "express";
import { AuthGuard } from "../auth/guard/auth.guard";

import { FoldersService } from "./folders.service";
import { CreateFolderDto } from "./dto/create-folder.dto";
import { UpdateFolderDto } from "./dto/update-folder.dto";

@Controller("/api/folders")
@UseGuards(AuthGuard)
export class FoldersController {
  constructor(private foldersService: FoldersService) {}

  @Post()
  async createFolder(@Request() req: ExpressRequest, @Body() createFolderDto: CreateFolderDto) {
    const userId = (req.user as any)?.sub;
    return this.foldersService.createFolder(userId, createFolderDto);
  }

  @Get()
  async getFolders(
    @Request() req: ExpressRequest,
    @Query("parentId") parentId?: string,
  ) {
    const userId = (req.user as any)?.sub;
    return this.foldersService.getFolders(userId, parentId);
  }

  @Get("/tree")
  async getFolderTree(@Request() req: ExpressRequest) {
    const userId = (req.user as any)?.sub;
    return this.foldersService.getFolderTree(userId);
  }

  @Get("/:folderId")
  async getFolder(@Request() req: ExpressRequest, @Param("folderId") folderId: string) {
    const userId = (req.user as any)?.sub;
    return this.foldersService.getFolder(folderId, userId);
  }

  @Put("/:folderId")
  async updateFolder(
    @Request() req: ExpressRequest,
    @Param("folderId") folderId: string,
    @Body() updateFolderDto: UpdateFolderDto,
  ) {
    const userId = (req.user as any)?.sub;
    return this.foldersService.updateFolder(folderId, userId, updateFolderDto);
  }

  @Delete("/:folderId")
  async deleteFolder(
    @Request() req: ExpressRequest, 
    @Param("folderId") folderId: string,
    @Query("deleteAll") deleteAll: boolean = true
  ) {
    const userId = (req.user as any)?.sub;
    return this.foldersService.deleteFolder(folderId, userId, deleteAll);
  }
}