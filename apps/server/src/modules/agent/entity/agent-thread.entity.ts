/** Agent Thread 映射：用户级连续对话容器，不承载模型隐藏状态或权限。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('agent_threads')
export class AgentThread {
  /** 服务端分配的 Thread UUID。 */
  @PrimaryColumn('uuid')
  id!: string;
  /** 可信认证用户 UUID。 */
  @Column('uuid')
  userId!: string;
  /** 可选用户可见标题；不作为模型系统指令。 */
  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;
  /** 归档时间；归档不删除消息。 */
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
  /** 数据库创建时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;
  /** Thread 元数据最后更新时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  updatedAt!: Date;
  /** 最近新增可见消息的数据库时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  lastActivityAt!: Date;
}
