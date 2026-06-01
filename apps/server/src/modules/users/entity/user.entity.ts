/**
 * 用户实体（TypeORM Entity）。
 *
 * 用途：
 * - 映射 users 表结构，作为用户系统的数据模型
 *
 * 输入：数据库行数据（TypeORM）
 * 输出：User 实例（TypeORM）
 */

import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

import { Session } from "../../auth/entity/session.entity";
import { Document } from "../../documents/entity/document.entity";
import { SearchHistory } from "../../search/entity/search-history.entity";

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ type: 'varchar' })
  password!: string; // 存储哈希值

  @Column({ type: 'varchar', nullable: true })
  name!: string;

  /** 头像相对 URL，如 /uploads/avatars/{id}.png */
  @Column({ type: 'varchar', nullable: true })
  avatarUrl!: string | null;

  /** 通知、隐私、编辑器等偏好 */
  @Column({ type: 'jsonb', nullable: true })
  settings!: Record<string, unknown> | null;

  /** 已用存储（字节），由 StorageUsageService 维护 */
  @Column({ type: 'bigint', default: 0 })
  storageUsedBytes!: string;

  /** 存储配额（字节） */
  @Column({ type: 'bigint', default: String(10 * 1024 * 1024 * 1024) })
  storageQuotaBytes!: string;

  /** 上次存储统计计算时间 */
  @Column({ type: 'timestamptz', nullable: true })
  storageCalculatedAt!: Date | null;

  /**
   * 用户会话
   */
  @OneToMany(() => Session, session => session.user)
  sessions!: Session[];

  /**
   * 用户文档
   */
  @OneToMany(() => Document, document => document.user)
  documents!: Document[];

  /**
   * 搜索历史
   */
  @OneToMany(() => SearchHistory, searchHistory => searchHistory.user)
  searchHistory!: SearchHistory[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}