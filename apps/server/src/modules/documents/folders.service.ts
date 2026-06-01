import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { Folder } from "./entity/folder.entity";
import { CreateFolderDto } from "./dto/create-folder.dto";
import { UpdateFolderDto } from "./dto/update-folder.dto";
import { StorageUsageService } from "../storage/storage-usage.service";
import { DocumentsService } from "./documents.service";

@Injectable()
export class FoldersService {
  constructor(
    @InjectRepository(Folder)
    private foldersRepository: Repository<Folder>,
    private readonly documentsService: DocumentsService,
    private readonly storageUsageService: StorageUsageService,
  ) {}

  async createFolder(userId: string, createFolderDto: CreateFolderDto): Promise<Folder> {
    const folder = this.foldersRepository.create({
      name: createFolderDto.name,
      parentId: createFolderDto.parentId,
      description: createFolderDto.description,
      userId,
    });
    const saved = await this.foldersRepository.save(folder);
    this.storageUsageService.scheduleRecalculate(userId);
    return saved;
  }

  async getFolders(userId: string, parentId?: string): Promise<Folder[]> {
    const where: Record<string, any> = { userId };
    if (parentId !== undefined) {
      where.parentId = parentId;
    }
    return this.foldersRepository.find({
      where,
      order: { updatedAt: "DESC" },
    });
  }

  async getFolder(folderId: string, userId: string): Promise<Folder> {
    const folder = await this.foldersRepository.findOne({
      where: { id: folderId, userId },
    });

    if (!folder) {
      throw new NotFoundException(`Folder with id ${folderId} not found`);
    }

    return folder;
  }

  async updateFolder(folderId: string, userId: string, updateFolderDto: UpdateFolderDto): Promise<Folder> {
    const folder = await this.getFolder(folderId, userId);
    if (updateFolderDto.name !== undefined) {
      folder.name = updateFolderDto.name;
    }
    if (updateFolderDto.parentId !== undefined) {
      folder.parentId = updateFolderDto.parentId;
    }
    if (updateFolderDto.description !== undefined) {
      folder.description = updateFolderDto.description;
    }
    const saved = await this.foldersRepository.save(folder);
    this.storageUsageService.scheduleRecalculate(userId);
    return saved;
  }

  async deleteFolder(folderId: string, userId: string, deleteAll: boolean = true): Promise<void> {
    const folder = await this.getFolder(folderId, userId);

    if (deleteAll) {
      await this.deleteFolderWithContent(folderId, userId);
    } else {
      await this.deleteFolderOnly(folderId, userId);
    }
    this.storageUsageService.scheduleRecalculate(userId);
  }

  private async deleteFolderWithContent(folderId: string, userId: string): Promise<void> {
    const childFolders = await this.foldersRepository.find({ where: { userId, parentId: folderId } });
    
    for (const child of childFolders) {
      await this.deleteFolderWithContent(child.id, userId);
    }

    await this.documentsService.softDeleteDocumentsInFolder(userId, folderId);
    await this.foldersRepository.delete({ id: folderId, userId });
  }

  private async deleteFolderOnly(folderId: string, userId: string): Promise<void> {
    const childFolders = await this.foldersRepository.find({ where: { userId, parentId: folderId } });
    
    for (const child of childFolders) {
      child.parentId = null;
      await this.foldersRepository.save(child);
    }

    await this.documentsService.unlinkDocumentsFromFolder(userId, folderId);
    await this.foldersRepository.delete({ id: folderId, userId });
  }

  async getFolderTree(userId: string): Promise<Folder[]> {
    const allFolders = await this.foldersRepository.find({
      where: { userId },
      order: { updatedAt: "DESC" },
    });

    const folderMap = new Map<string, Folder>();
    const rootFolders: Folder[] = [];

    allFolders.forEach(folder => {
      folderMap.set(folder.id, { ...folder, children: [] });
    });

    folderMap.forEach(folder => {
      if (folder.parentId && folderMap.has(folder.parentId)) {
        const parent = folderMap.get(folder.parentId)!;
        if (!parent.children) parent.children = [];
        parent.children.push(folder);
      } else {
        rootFolders.push(folder);
      }
    });

    return rootFolders;
  }
}