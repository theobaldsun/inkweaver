/**
 * 文档快照实体
 *
 * 用途：
 * - 存储文档的全量快照
 * - 用于快速恢复和同步
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity()
@Index(['docId'], { unique: true }) // 每个文档只有一个最新快照
@Index(['version']) // 版本索引
@Index(['createdAt']) // 时间索引
export class DocSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  docId!: string;

  @Column({ type: "text" })
  snapshot!: string; // Base64 编码的 Yjs 文档快照

  @Column({ type: "bigint", default: 0 })
  version!: number; // 快照对应的最后 update_id

  @Column({ type: "bigint", default: 0 })
  updateCount!: number; // 基于的更新数量

  @Column({ type: "bigint", nullable: true })
  size!: number; // 快照大小（字节）

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}