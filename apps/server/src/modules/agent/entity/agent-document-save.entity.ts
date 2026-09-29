/** Agent 文档保存操作实体；与固定成果版本绑定，确认及写入仍须走执行层。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('agent_document_saves')
export class AgentDocumentSave {
  /** 保存操作 UUID。 */
  @PrimaryColumn('uuid')
  id!: string;

  /** 可信用户归属。 */
  @Column('uuid')
  userId!: string;

  /** 成果与执行 Run 共享的会话。 */
  @Column('uuid')
  threadId!: string;

  /** 承担保存操作的 Run，可区别于生成成果的 Run。 */
  @Column('uuid')
  runId!: string;

  /** 固定成果版本，首版每个版本只允许一个保存绑定。 */
  @Column('uuid')
  artifactVersionId!: string;

  /** 同一用户和 Run 内的逻辑操作键。 */
  @Column({ type: 'varchar', length: 128 })
  requestKey!: string;

  /** 服务端预留的目标文档 UUID；PREPARED 不表示文档已经存在。 */
  @Column('uuid')
  documentId!: string;

  /** 目标文件夹；null 表示个人库根目录，仍须授权。 */
  @Column('uuid', { nullable: true })
  folderId!: string | null;

  /** 绑定成果摘要和保存位置；不是执行授权凭据。 */
  @Column({ type: 'char', length: 64 })
  digest!: string;

  /** 保存状态；只有原子写入入口能提交 SAVED。 */
  @Column({ type: 'varchar', length: 16, default: 'PREPARED' })
  status!: 'PREPARED' | 'SAVED';

  /** 操作创建时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;

  /** 与成功写入同事务提交的工具调用 UUID；准备阶段为 null。 */
  @Column('uuid', { nullable: true })
  savedCallId!: string | null;

  /** 成功提交时间；未真正创建文档时为 null。 */
  @Column({ type: 'timestamptz', nullable: true })
  savedAt!: Date | null;

  /** 已成功投递向量索引的时间；null 表示待投递，不能代表索引已完成。 */
  @Column({ type: 'timestamptz', nullable: true })
  indexScheduledAt!: Date | null;
}
