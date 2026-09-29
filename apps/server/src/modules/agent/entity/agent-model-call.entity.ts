/** 模型调用审计实体；不保存提示词、正文、凭据或隐藏推理，表由迁移创建。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('agent_model_calls')
export class AgentModelCall {
  /** 调用尝试 UUID。 */
  @PrimaryColumn('uuid')
  id!: string;

  /** 所属 Run。 */
  @Column('uuid')
  runId!: string;

  /** 可信用户归属。 */
  @Column('uuid')
  userId!: string;

  /** 模型标识；未配置时为空。 */
  @Column({ type: 'text', nullable: true })
  model!: string | null;

  /** 调用状态；遗留 STARTED 代表结果及费用尚未确认。 */
  @Column({ type: 'varchar', length: 16 })
  status!: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';

  /** 供应商实际 Token 数，未知为 null，不以估算替代。 */
  @Column({ type: 'double precision', nullable: true })
  inputTokens!: number | null;

  /** 供应商实际 Token 数，未知为 null，不以估算替代。 */
  @Column({ type: 'double precision', nullable: true })
  outputTokens!: number | null;

  /** 供应商实际 Token 数，未知为 null，不以估算替代。 */
  @Column({ type: 'double precision', nullable: true })
  totalTokens!: number | null;

  /** 按配置预占的上下文额度；历史未记录为 null，与供应商实际用量分开。 */
  @Column({ type: 'integer', nullable: true })
  reservedTokens!: number | null;

  /** 毫秒耗时，未知为 null。 */
  @Column({ type: 'double precision', nullable: true })
  latencyMs!: number | null;

  /** 稳定错误码，不保存原始异常。 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode!: string | null;

  /** 数据库开始时间。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;

  /** 数据库结束时间；未完成时为空。 */
  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

}
