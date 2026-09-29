/** Agent 成果持久化实体；表和关系约束由迁移创建，类型不承担鉴权。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('agent_artifact_sources')
export class AgentArtifactSource {
  /** 版本 UUID，与标签组成主键。 */
  @PrimaryColumn('uuid')
  versionId!: string;

  /** 此版本冻结的引用标签，不随来源重新编号变化。 */
  @PrimaryColumn({ type: 'varchar', length: 16 })
  label!: string;

  /** 不可变来源片段的 UUID，不是授权凭据。 */
  @Column('uuid')
  sourceId!: string;

  /** 来源与版本必须属于同一 Run。 */
  @Column('uuid')
  runId!: string;

  /** 用户归属。 */
  @Column('uuid')
  userId!: string;

}
