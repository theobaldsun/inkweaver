/**
 * 用户会话实体（TypeORM Entity）。
 *
 * 用途：
 * - 管理用户登录会话，支持多设备登录
 * - 记录登录设备信息和登录时间
 *
 * 输入：用户登录信息
 * 输出：会话记录
 */

import { 
  Column, 
  CreateDateColumn, 
  Entity, 
  ManyToOne, 
  PrimaryGeneratedColumn, 
  UpdateDateColumn 
} from "typeorm";

import { User } from "../../users/entity/user.entity";
import { ApiProperty } from '@nestjs/swagger';

export enum SessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: '会话ID' })
  id!: string;

  /**
   * 关联的用户
   */
  @ManyToOne(() => User, user => user.sessions, { onDelete: 'CASCADE' })
  @ApiProperty({ description: '关联的用户' })
  user!: User;

  @Column({ type: 'uuid' })
  @ApiProperty({ description: '用户ID' })
  userId!: string;

  /**
   * 刷新令牌（存储哈希值）
   */
  @Column({ type: 'varchar' })
  @ApiProperty({ description: '刷新令牌（存储哈希值）' })
  refreshTokenHash!: string;

  /**
   * 刷新令牌的 SHA-256 哈希，用于快速定位会话，避免逐条 bcrypt 扫描。
   */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ description: '刷新令牌的 SHA-256 哈希（用于快速定位）' })
  refreshTokenLookup?: string;

  /**
   * 设备信息
   */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ description: '设备类型' })
  deviceType?: string; // web, mobile, desktop

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ description: '设备名称' })
  deviceName?: string; // 设备名称

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ description: '操作系统' })
  os?: string; // 操作系统

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ description: '浏览器' })
  browser?: string; // 浏览器

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ description: 'IP地址' })
  ipAddress?: string; // IP地址

  /**
   * 会话状态
   */
  @Column({ 
    type: 'enum', 
    enum: SessionStatus, 
    default: SessionStatus.ACTIVE 
  })
  @ApiProperty({ description: '会话状态' })
  status!: SessionStatus;

  /**
   * 过期时间
   */
  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: '过期时间' })
  expiresAt!: Date;

  /**
   * 最后活动时间
   */
  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: '最后活动时间' })
  lastActivityAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}