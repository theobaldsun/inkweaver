/**
 * 同步更新实体
 *
 * 用途：
 * - 存储 Yjs 同步更新
 * - 实现持久化存储和冲突检测
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from "typeorm";

@Entity()
@Index(['docId', 'createdAt']) // 时间索引用于查询
@Index(['docId']) // 文档索引
export class SyncUpdate {
  @PrimaryGeneratedColumn()
  updateId!: number; // 自增主键作为业务updateId，用于冲突检测和游标分页

  @Column()
  docId!: string;

  @Column({ type: "text" })
  update!: string; // Base64 编码的 Yjs update

  @Column({ type: "bigint" })
  timestamp!: number;

  @Column({ nullable: true })
  clientId?: string; // 客户端ID，用于追踪更新来源

  @CreateDateColumn()
  createdAt!: Date;
}
