/**
 * 文档实体（TypeORM Entity）。
 *
 * 用途：
 * - 映射 documents 表结构，作为文档系统的数据模型
 *
 * 输入：数据库行数据（TypeORM）
 * 输出：Document 实例（TypeORM）
 */

import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

import { User } from "../../users/entity/user.entity";

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'boolean', default: false })
  isPublic!: boolean;

  @Column({ type: 'varchar', nullable: true })
  shareLink!: string;

  @Column({ type: 'jsonb', nullable: true })
  tags!: string[];

  /** 文档所属文件夹 ID（uuid 类型，与 folders.id 保持一致以便外键关联） */
  @Column({ type: 'uuid', nullable: true })
  folderId!: string | null;

  /**
   * 文档所属用户
   */
  @ManyToOne(() => User, user => user.documents)
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  /** 移入回收站的时间；null 表示正常文档 */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  /** 删除前所在文件夹，用于恢复 */
  @Column({ type: 'uuid', nullable: true })
  deletedFromFolderId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
