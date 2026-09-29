/** Agent 成果持久化实体；表和关系约束由迁移创建，类型不承担鉴权。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('agent_artifacts')
export class AgentArtifact {
  /** 成果 UUID；由可信调用方生成并在重试时复用。 */
  @PrimaryColumn('uuid')
  id!: string;

  /** 所属会话，后续 Run 可在同一会话继续修订。 */
  @Column('uuid')
  threadId!: string;

  /** 服务端已认证的用户归属。 */
  @Column('uuid')
  userId!: string;

  /** 创建时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;

}
