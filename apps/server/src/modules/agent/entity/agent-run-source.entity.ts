/** Agent Run 来源快照：保存用户可审计的来源事实，不保存模型隐藏推理。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('agent_run_sources')
export class AgentRunSource {
  /** 服务端生成的来源 UUID。 */
  @PrimaryColumn('uuid')
  id!: string;

  /** 所属 Run UUID。 */
  @Column('uuid')
  runId!: string;

  /** 可信用户归属 UUID。 */
  @Column('uuid')
  userId!: string;

  /** 来源文档 UUID；即使原文后续删除也保留该历史标识。 */
  @Column('uuid')
  docId!: string;

  /** 同一 Run 内稳定去重键，绑定文档与当时版本。 */
  @Column({ type: 'varchar', length: 160 })
  sourceKey!: string;

  /** 本次片段主要来自 RAG、搜索摘要或受控工具。 */
  @Column({ type: 'varchar', length: 16 })
  retrievalKind!: 'rag' | 'search' | 'tool' | 'revision';

  /** 继承的历史来源 UUID；只复制可访问快照，不冒充本次重新检索的最新内容。 */
  @Column('uuid', { nullable: true })
  inheritedFromSourceId!: string | null;

  /** 捕获时的来源标题快照。 */
  @Column({ type: 'varchar', length: 500 })
  title!: string;

  /** 实际进入候选上下文的受限片段，不保存整篇原文。 */
  @Column('text')
  excerpt!: string;

  /** 权限复核时观察到的 documents.updatedAt；不证明异步索引已同步至此版本。 */
  @Column({ type: 'timestamptz', nullable: true })
  documentUpdatedAt!: Date | null;

  /** 工具返回的正文/位置版本摘要；检索来源没有此保证时为空。 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  documentVersion!: string | null;

  /** 对应已成功的逻辑工具调用；普通检索来源为空。 */
  @Column({ type: 'uuid', nullable: true })
  toolCallId!: string | null;

  /** 归一化相关度 0~1；无可比分数时为空。 */
  @Column({ type: 'double precision', nullable: true })
  score!: number | null;

  /** 当前一次上下文构建是否选中该快照。 */
  @Column({ type: 'boolean', default: false })
  usedInContext!: boolean;

  /** 本次上下文的固定标签；未选中或旧记录为 null，不能由模型自行签发。 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  citationLabel!: string | null;

  /** 最终可见回答是否确认引用该来源；由后续引用校验更新。 */
  @Column({ type: 'boolean', default: false })
  cited!: boolean;

  /** 数据库创建时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;

  /** 最近一次上下文选择更新时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  updatedAt!: Date;
}
