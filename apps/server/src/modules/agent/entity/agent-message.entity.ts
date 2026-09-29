/** Agent Message 映射：只保存用户可见内容，不保存隐藏推理、供应商原始包或凭据。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { AgentContentBlock } from '@inkweaver/shared';

@Entity('agent_messages')
export class AgentMessage {
  /** 服务端分配的 Message UUID。 */
  @PrimaryColumn('uuid')
  id!: string;
  /** 所属 Thread UUID。 */
  @Column('uuid')
  threadId!: string;
  /** 用户归属 UUID。 */
  @Column('uuid')
  userId!: string;
  /** 首版只保存用户输入和 Agent 可见回复。 */
  @Column({ type: 'varchar', length: 16 })
  role!: 'user' | 'assistant';
  /** ContentBlock 契约版本。 */
  @Column({ type: 'smallint', default: 1 })
  contentVersion!: 1;
  /** 严格解析后的内容块数组。 */
  @Column('jsonb')
  content!: AgentContentBlock[];
  /** 用户请求去重键；仅 user 消息允许设置。 */
  @Column({ type: 'varchar', length: 128, nullable: true })
  requestKey!: string | null;
  /** 绑定正文、模式与工作流版本的 SHA-256；同 key 不同请求拒绝。 */
  @Column({ type: 'char', length: 64, nullable: true })
  requestDigest!: string | null;
  /** 关联执行该消息的 Run；创建用户消息时暂为空，同事务绑定，助手回复关联已有 Run。 */
  @Column('uuid', { nullable: true })
  runId!: string | null;
  /** 数据库创建时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
