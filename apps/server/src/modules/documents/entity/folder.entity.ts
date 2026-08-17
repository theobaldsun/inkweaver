import { Column, CreateDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

import { User } from "../../users/entity/user.entity";

@Entity('folders')
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  /** 父文件夹 ID（uuid 类型，与自身 id 保持一致以便外键关联） */
  @Column({ type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  description!: string;

  @ManyToOne(() => User, user => user.id)
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  @OneToMany(() => Folder, folder => folder.parentId)
  children!: Folder[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}