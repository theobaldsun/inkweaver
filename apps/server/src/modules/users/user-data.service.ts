/**
 * 用户数据导出与清理服务。
 *
 * 用途：导出 JSON、清空用户数据、注销账户（事务）
 */

import { mergeUserSettings } from '@inkweaver/shared';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { User } from './entity/user.entity';
import { DocumentChunk } from '../ai/entity/document-chunk.entity';
import { AuthService } from '../auth/auth.service';
import { PasswordResetToken } from './entity/password-reset-token.entity';
import { Session } from '../auth/entity/session.entity';
import { Document } from '../documents/entity/document.entity';
import { Folder } from '../documents/entity/folder.entity';
import { Notification } from '../notifications/notification.entity';
import { SearchHistory } from '../search/entity/search-history.entity';
import { ObjectStorageService, toObjectKey } from '../storage/object-storage.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { DocSnapshot } from '../sync/entity/doc-snapshot.entity';
import { SyncUpdate } from '../sync/entity/sync-update.entity';

@Injectable()
export class UserDataService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
    @InjectRepository(Folder)
    private readonly foldersRepository: Repository<Folder>,
    @InjectRepository(SearchHistory)
    private readonly searchHistoryRepository: Repository<SearchHistory>,
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    @InjectRepository(SyncUpdate)
    private readonly syncUpdateRepository: Repository<SyncUpdate>,
    @InjectRepository(DocSnapshot)
    private readonly docSnapshotRepository: Repository<DocSnapshot>,
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly storageUsageService: StorageUsageService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  /**
   * 校验密码后导出用户数据。
   */
  async exportUserData(userId: string, password: string): Promise<Record<string, unknown>> {
    await this.assertPassword(userId, password);
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const { password: _pw, ...profile } = user;
    const documents = await this.documentsRepository.find({ where: { userId } });
    const folders = await this.foldersRepository.find({ where: { userId } });
    const searchHistory = await this.searchHistoryRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 500,
    });

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        ...profile,
        settings: mergeUserSettings(profile.settings as Record<string, unknown> | null),
      },
      documents,
      folders,
      searchHistory,
    };
  }

  /**
   * 永久删除用户全部业务数据，保留账户。
   */
  async purgeUserData(userId: string, password: string): Promise<{ message: string }> {
    await this.assertPassword(userId, password);
    await this.deleteAllUserContent(userId);
    this.storageUsageService.scheduleRecalculate(userId);
    return { message: '已删除全部数据' };
  }

  /**
   * 注销账户并删除所有关联数据。
   */
  async deleteUserAccount(userId: string, password: string): Promise<{ message: string }> {
    await this.assertPassword(userId, password);
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    await this.deleteAllUserContent(userId, {
      deleteAccount: true,
      avatarUrl: user.avatarUrl,
    });
    return { message: '账户已注销' };
  }

  private async assertPassword(userId: string, passwordHash: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    const valid = await this.authService.validatePassword(passwordHash, user.password);
    if (!valid) {
      throw new UnauthorizedException('密码错误');
    }
  }

  private async deleteAllUserContent(
    userId: string,
    options: { deleteAccount?: boolean; avatarUrl?: string | null } = {},
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const docs = await queryRunner.manager.find(Document, { where: { userId } });
      for (const doc of docs) {
        await queryRunner.manager.delete(SyncUpdate, { docId: doc.id });
        await queryRunner.manager.delete(DocSnapshot, { docId: doc.id });
      }
      await queryRunner.manager.delete(DocumentChunk, { userId });
      await queryRunner.manager.delete(Document, { userId });
      await queryRunner.manager.delete(Folder, { userId });
      await queryRunner.manager.delete(SearchHistory, { userId });
      await queryRunner.manager.delete(Notification, { userId });
      await queryRunner.manager.delete(PasswordResetToken, { userId });
      await queryRunner.manager.delete(Session, { userId });

      // 外部对象删除放在提交前：失败时数据库回滚，调用方可用相同请求安全重试。
      await this.objectStorage.deletePrefix(`assets/${userId}`);
      if (options.deleteAccount && options.avatarUrl) {
        const avatarKey = toObjectKey(options.avatarUrl);
        if (avatarKey?.startsWith('avatars/')) {
          await this.objectStorage.deleteObject(avatarKey);
        }
      }
      if (options.deleteAccount) {
        await queryRunner.manager.delete(User, { id: userId });
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

}
