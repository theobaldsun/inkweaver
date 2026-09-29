/** Agent 成果持久化实体；表和关系约束由迁移创建，类型不承担鉴权。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { AgentEvidenceReport } from '../agent-evidence';

@Entity('agent_artifact_versions')
export class AgentArtifactVersion {
  /** 版本 UUID。 */
  @PrimaryColumn('uuid')
  id!: string;

  /** 稳定的成果标识。 */
  @Column('uuid')
  artifactId!: string;

  /** 会话归属。 */
  @Column('uuid')
  threadId!: string;

  /** 用户归属。 */
  @Column('uuid')
  userId!: string;

  /** 生成此版本的 Run。 */
  @Column('uuid')
  runId!: string;

  /** 从 1 开始递增，首版最多 50 个版本。 */
  @Column('integer')
  version!: number;

  /** 提纲或草稿；同一成果可以从提纲演进为草稿。 */
  @Column({ type: 'varchar', length: 16 })
  kind!: 'outline' | 'draft';

  /** 标题，最多 200 个 Unicode 字符。 */
  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** Markdown 正文，最多 262144 个 UTF-8 字节。 */
  @Column('text')
  content!: string;

  /** 结构化证据问题；null 表示未分析，空 items 不代表已证明没有冲突。 */
  @Column('jsonb', { nullable: true })
  evidence!: AgentEvidenceReport | null;

  /** 幂等内容摘要，包含生成 Run 和引用映射。 */
  @Column({ type: 'char', length: 64 })
  digest!: string;

  /** 版本创建时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;

}
