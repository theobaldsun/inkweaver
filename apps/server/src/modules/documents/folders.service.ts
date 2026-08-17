/**
 * 文件夹管理服务
 *
 * 核心职责：
 * - 管理用户文件夹的 CRUD 操作（创建、查询、更新、删除）
 * - 维护文件夹树结构（父子关系、循环引用防护）
 * - 文件夹变更时联动触发存储用量重算
 *
 * 数据来源：
 * - folders 表（Folder 实体）：文件夹元数据与 parentId 关联
 * - documents 表：删除文件夹时级联处理文档
 *
 * 关键策略：
 * - 循环引用防护：updateFolder 时通过 BFS 检查后代，防止 A→B→A 循环
 * - 存储用量联动：创建/更新/删除文件夹后均调用 scheduleRecalculate
 * - 软删除优先：deleteFolderWithContent 对文档执行软删除而非物理删除
 */

import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
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

  /**
   * 创建文件夹
   *
   * @param userId 用户 ID
   * @param createFolderDto 创建参数（name、parentId、description）
   */
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

  /**
   * 查询文件夹列表
   *
   * @param userId 用户 ID
   * @param parentId 可选的父文件夹 ID；不传则返回所有顶层文件夹
   */
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

  /**
   * 获取单个文件夹详情
   *
   * @param folderId 文件夹 ID
   * @param userId 用户 ID（限定权限范围）
   * @throws NotFoundException 文件夹不存在或不属于当前用户
   */
  async getFolder(folderId: string, userId: string): Promise<Folder> {
    const folder = await this.foldersRepository.findOne({
      where: { id: folderId, userId },
    });

    if (!folder) {
      throw new NotFoundException(`Folder with id ${folderId} not found`);
    }

    return folder;
  }

  /**
   * 更新文件夹信息
   *
   * 可更新字段：name、parentId、description。
   * 变更 parentId 时执行两道循环引用防护：
   * 1. 不能将文件夹移动到自身下（自引用）
   * 2. 不能将文件夹移动到其后代下（防止 A→B→A 循环）
   *
   * @param folderId 文件夹 ID
   * @param userId 用户 ID
   * @param updateFolderDto 更新参数
   * @throws NotFoundException 目标父文件夹不存在
   * @throws BadRequestException 检测到循环引用
   */
  async updateFolder(folderId: string, userId: string, updateFolderDto: UpdateFolderDto): Promise<Folder> {
    const folder = await this.getFolder(folderId, userId);
    if (updateFolderDto.name !== undefined) {
      folder.name = updateFolderDto.name;
    }
    if (updateFolderDto.parentId !== undefined) {
      const newParentId = updateFolderDto.parentId;

      if (newParentId !== null) {
        // 校验目标父文件夹存在且归属当前用户
        const parentExists = await this.foldersRepository.exist({
          where: { id: newParentId, userId },
        });
        if (!parentExists) {
          throw new NotFoundException(`Parent folder not found or does not belong to current user`);
        }

        // 防止循环引用：不能将文件夹挂到自身或其后代下
        if (newParentId === folderId) {
          throw new BadRequestException('不能将文件夹移动到自身下');
        }
        const wouldCreateCycle = await this.isDescendant(folderId, newParentId, userId);
        if (wouldCreateCycle) {
          throw new BadRequestException('不能将文件夹移动到其后代下，否则会产生循环引用');
        }
      }

      folder.parentId = newParentId;
    }
    if (updateFolderDto.description !== undefined) {
      folder.description = updateFolderDto.description;
    }
    const saved = await this.foldersRepository.save(folder);
    this.storageUsageService.scheduleRecalculate(userId);
    return saved;
  }

  /**
   * 删除文件夹
   *
   * @param folderId 文件夹 ID
   * @param userId 用户 ID
   * @param deleteAll true=级联删除所有子文件夹和文档；false=仅删除文件夹本身（子文件夹升为根）
   */
  async deleteFolder(folderId: string, userId: string, deleteAll: boolean = true): Promise<void> {
    const folder = await this.getFolder(folderId, userId);

    if (deleteAll) {
      await this.deleteFolderWithContent(folderId, userId);
    } else {
      await this.deleteFolderOnly(folderId, userId);
    }
    this.storageUsageService.scheduleRecalculate(userId);
  }

  /**
   * 级联删除：迭代收集所有子文件夹 → 逆序删除（子先父后）
   *
   * 使用迭代而非递归，防止深嵌套时栈溢出。
   * 设置 MAX_FOLDERS 上限（500），超过则拒绝操作，防止恶意构造深嵌套拖垮服务。
   */
  private static readonly MAX_DELETE_FOLDERS = 500;

  private async deleteFolderWithContent(folderId: string, userId: string): Promise<void> {
    // 迭代收集所有待删除的文件夹 ID（BFS，避免递归栈溢出）
    const folderIdsToDelete: string[] = [];
    const visited = new Set<string>();
    const queue = [folderId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      folderIdsToDelete.push(currentId);

      if (folderIdsToDelete.length > FoldersService.MAX_DELETE_FOLDERS) {
        throw new BadRequestException(
          `待删除文件夹数量超过上限（${FoldersService.MAX_DELETE_FOLDERS}），已拒绝操作`
        );
      }

      const children = await this.foldersRepository.find({
        where: { parentId: currentId, userId },
        select: ['id'],
      });
      for (const child of children) {
        if (!visited.has(child.id)) {
          queue.push(child.id);
        }
      }
    }

    // 逆序删除：从最深层开始，确保子文件夹先被清理
    for (let i = folderIdsToDelete.length - 1; i >= 0; i--) {
      const id = folderIdsToDelete[i]!;
      await this.documentsService.softDeleteDocumentsInFolder(userId, id);
      await this.foldersRepository.delete({ id, userId });
    }
  }

  /**
   * 仅删除文件夹：将直接子文件夹提升为根节点
   *
   * 流程：
   * 1. BFS 预检查：收集所有后代文件夹 ID，超过 MAX_FOLDERS 上限则拒绝
   * 2. 提升直接子文件夹：设置 parentId = null，保持孙子及更深后代的子树结构
   * 3. 解除文档与文件夹的关联，删除文件夹本身
   *
   * 注意：树结构会被保留。例如 A→B→C→D，删除 A(deleteOnly) 后，
   * B 升为根，C/D 仍保持在 B 下的层级关系，不会产生孤儿节点。
   *
   * @param folderId 要删除的文件夹 ID
   * @param userId 用户 ID（限定权限范围）
   */
  private async deleteFolderOnly(folderId: string, userId: string): Promise<void> {
    // BFS 收集所有后代（含自身），用于深度上限校验
    const allIds: string[] = [];
    const visited = new Set<string>();
    const queue = [folderId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      allIds.push(currentId);

      if (allIds.length > FoldersService.MAX_DELETE_FOLDERS) {
        throw new BadRequestException(
          `后代文件夹数量超过上限（${FoldersService.MAX_DELETE_FOLDERS}），已拒绝操作`,
        );
      }

      const children = await this.foldersRepository.find({
        where: { parentId: currentId, userId },
        select: ['id'],
      });
      for (const child of children) {
        if (!visited.has(child.id)) {
          queue.push(child.id);
        }
      }
    }

    // 提升直接子文件夹为根（仅当存在后代时）
    if (allIds.length > 1) {
      const directChildren = await this.foldersRepository.find({
        where: { userId, parentId: folderId },
      });
      for (const child of directChildren) {
        child.parentId = null;
        await this.foldersRepository.save(child);
      }
    }

    // 解除文档关联 + 删除文件夹
    await this.documentsService.unlinkDocumentsFromFolder(userId, folderId);
    await this.foldersRepository.delete({ id: folderId, userId });
  }

  /**
   * 获取完整文件夹树
   *
   * 策略：先全量加载用户所有文件夹 → 构建 Map → 按 parentId 组装父子关系。
   * 时间复杂度 O(n)，空间复杂度 O(n)，适合中小型文件夹量。
   *
   * @param userId 用户 ID
   * @returns 根节点文件夹数组（包含 children 嵌套结构）
   */
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
        // parentId 不存在或父节点不在本用户范围内 → 作为根节点
        rootFolders.push(folder);
      }
    });

    return rootFolders;
  }

  /**
   * 检查 targetId 是否在 ancestorId 的后代中。
   *
   * 用途：防止 updateFolder 设置 parentId 时产生循环引用。
   * 使用 BFS（广度优先搜索）逐层遍历子树，避免 DFS 深栈风险。
   *
   * @param ancestorId 起始文件夹 ID
   * @param targetId 目标文件夹 ID
   * @param userId 用户 ID（限定在用户自己的文件夹范围内，防止越权）
   * @returns true=targetId 是 ancestorId 的后代，false=不是
   */
  private async isDescendant(ancestorId: string, targetId: string, userId: string): Promise<boolean> {
    const queue = [ancestorId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = await this.foldersRepository.find({
        where: { parentId: currentId, userId },
        select: ['id'],
      });

      for (const child of children) {
        if (child.id === targetId) {
          return true;
        }
        queue.push(child.id);
      }
    }

    return false;
  }
}