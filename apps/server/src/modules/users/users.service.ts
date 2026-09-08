
import { mergeUserSettings, type UserSettings } from "@inkweaver/shared";
import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";

import { User } from "./entity/user.entity";
import { matchesImageSignature } from "../../common/image-signature";
import { hashDigestForStorage, verifyPasswordDigest, digestPlainPassword } from "../../common/password-crypto";
import { AuthService } from "../auth/auth.service";
import { SessionService } from "../auth/session.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import { StorageUsageService } from "../storage/storage-usage.service";
import { UpdateUserSettingsDto } from "./dto/update-user-settings.dto";

import type { CreateSessionData } from "../auth/session.service";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PG_UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly storageUsageService: StorageUsageService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async create(email: string, passwordHash: string, name?: string): Promise<User> {
    const hashedPassword = await hashDigestForStorage(passwordHash);
    const user = this.usersRepository.create({
      email,
      password: hashedPassword,
      name,
      avatarUrl: null,
      settings: null,
    });
    return this.usersRepository.save(user);
  }

  /**
   * 注册用户并签发令牌（与 login 返回结构一致）。
   *
   * 流程：
   * 1. 前置检查：查询邮箱是否已存在（快速路径）
   * 2. 创建用户：INSERT 到数据库
   * 3. TOCTOU 防御：捕获唯一约束冲突（23505），转为 ConflictException
   *    —— 两个并发注册同一邮箱的请求，第一个成功，第二个因唯一约束被拒
   * 4. 登录并返回令牌
   */
  async register(
    email: string,
    passwordHash: string,
    name?: string,
    sessionMeta?: Partial<CreateSessionData>,
  ) {
    const existingUser = await this.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('邮箱已存在');
    }

    try {
      await this.create(email, passwordHash, name);
    } catch (err) {
      // TOCTOU：并发注册时，第二个 INSERT 会触发 PostgreSQL 唯一约束冲突（23505）
      if (err instanceof QueryFailedError && err.driverError?.code === PG_UNIQUE_VIOLATION_CODE) {
        throw new ConflictException('邮箱已存在');
      }
      throw err;
    }

    return this.login(email, passwordHash, sessionMeta);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  /**
   * 用户登录验证
   */
  async validateUser(email: string, passwordHash: string): Promise<User> {
    const user = await this.findByEmail(email);
    
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }

    const isPasswordValid = await verifyPasswordDigest(passwordHash, user.password);
    
    if (!isPasswordValid) {
      throw new UnauthorizedException("密码错误");
    }

    return user;
  }

  /**
   * 将用户密码从旧版 bcrypt(明文) 迁移为 bcrypt(SHA-256 摘要)（管理/开发用）。
   * @param email 用户邮箱
   * @param plainPassword 当前明文密码（仅用于本地迁移脚本，不经 API 传输）
   */
  async rehashPasswordFromPlain(email: string, plainPassword: string): Promise<void> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    const digest = digestPlainPassword(plainPassword);
    user.password = await hashDigestForStorage(digest);
    await this.usersRepository.save(user);
  }

  /**
   * 用户登录
   */
  async login(email: string, passwordHash: string, sessionMeta?: Partial<CreateSessionData>) {
    const user = await this.validateUser(email, passwordHash);
    return this.authService.login(user, sessionMeta);
  }

  /**
   * 更新用户信息
   */
  async updateUser(id: string, updateData: Partial<User>) {
    const user = await this.findById(id);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }

    // 邮箱注册后不可修改
    const { email: _ignoredEmail, ...safeUpdate } = updateData;
    Object.assign(user, safeUpdate);
    const saved = await this.usersRepository.save(user);
    return this.toPublicProfile(saved);
  }

  /**
   * 修改密码：仅用 bcrypt 校验旧密码哈希，新密码只存哈希；成功后撤销全部会话。
   */
  async changePassword(id: string, oldPasswordHash: string, newPasswordHash: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }

    const isPasswordValid = await verifyPasswordDigest(oldPasswordHash, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("旧密码错误");
    }

    user.password = await hashDigestForStorage(newPasswordHash);
    await this.usersRepository.save(user);
    await this.sessionService.revokeAllUserSessions(id);
  }

  /**
   * 通过邮件重置链接设置新密码。
   */
  async setPasswordFromReset(userId: string, newPasswordHash: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    user.password = await hashDigestForStorage(newPasswordHash);
    await this.usersRepository.save(user);
    await this.sessionService.revokeAllUserSessions(userId);
  }

  /**
   * 获取用户信息（不含敏感字段）
   */
  async getUserProfile(id: string) {
    const user = await this.findById(id);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }
    return this.toPublicProfile(user);
  }

  async getUserSettings(userId: string): Promise<UserSettings> {
    const user = await this.findById(userId);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }
    return mergeUserSettings(user.settings as Partial<UserSettings> | null);
  }

  async updateUserSettings(userId: string, dto: UpdateUserSettingsDto): Promise<UserSettings> {
    const user = await this.findById(userId);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }
    const merged = mergeUserSettings({
      ...(user.settings as Partial<UserSettings> | null),
      ...dto,
    });
    user.settings = merged as unknown as Record<string, unknown>;
    await this.usersRepository.save(user);
    return merged;
  }

  /**
   * 保存用户头像文件并更新 avatarUrl。
   *
   * 校验流程：
   * 1. MIME 类型白名单（仅 JPEG/PNG/WebP）
   * 2. 文件大小限制（2MB）
   * 3. 魔数校验（防止恶意文件伪装成图片）
   */
  async updateAvatar(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ avatarUrl: string }> {
    if (!ALLOWED_AVATAR_MIME.has(file.mimetype)) {
      throw new BadRequestException('仅支持 JPEG、PNG、WebP 图片');
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException('头像不能超过 2MB');
    }
    if (!matchesImageSignature(file.mimetype, file.buffer)) {
      throw new BadRequestException('文件内容与声明的图片类型不匹配');
    }

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';

    const user = await this.findById(userId);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }

    const filename = `${userId}.${ext}`;
    const key = `avatars/${filename}`;
    await this.objectStorage.putObject({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    const avatarUrl = `/uploads/${key}`;
    user.avatarUrl = avatarUrl;
    await this.usersRepository.save(user);
    return { avatarUrl };
  }

  private toPublicProfile(user: User) {
    const { password: _password, ...rest } = user;
    return {
      ...rest,
      settings: mergeUserSettings(user.settings as Partial<UserSettings> | null),
    };
  }

  /**
   * 获取用户存储空间统计（标准格式 + 旧版字段兼容）
   */
  async getUserStorageStats(userId: string) {
    const usage = await this.storageUsageService.getUserStorageUsage(userId);
    return this.storageUsageService.toLegacyStats(usage);
  }
}
