import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../../users/entity/user.entity';

@Entity('search_history')
export class SearchHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  keyword!: string;

  @Column({ type: 'int', default: 1 })
  count!: number;

  @ManyToOne(() => User, (user) => user.searchHistory)
  user!: User;

  @Column({ type: 'varchar' })
  userId!: string;

  /** 该关键词最后一次使用的搜索模式；同一关键词不同模式搜索时覆盖为最新模式（兼容旧数据：默认 smart） */
  @Column({ type: 'varchar', length: 20, default: 'smart' })
  mode!: 'smart' | 'keyword' | 'semantic';

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}