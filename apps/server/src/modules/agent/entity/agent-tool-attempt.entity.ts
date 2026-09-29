/** agent_tool_attempts 映射：每轮尝试独立保存，不含参数、供应商响应或凭据。 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('agent_tool_attempts')
export class AgentToolAttempt {
  /** 服务端分配的执行代次 UUID；不等同于授权或外部幂等键。 */
  @PrimaryColumn('uuid')
  id!: string;
  /** 逻辑调用 UUID。 */
  @Column('uuid')
  callId!: string;
  /** Run UUID，组合外键保证与调用一致。 */
  @Column('uuid')
  runId!: string;
  /** 用户 UUID，查询必须限定归属。 */
  @Column('uuid')
  userId!: string;
  /** 调用内从 1 开始的执行代次，与 START 后 attemptCount 一致。 */
  @Column('integer')
  attemptNumber!: number;
  /** 启动时调用修订号；后续状态更新不覆盖它。 */
  @Column('integer')
  startRevision!: number;
  /** 本轮已知结果；OUTCOME_UNKNOWN 不代表外部操作已停止。 */
  @Column({ type: 'varchar', length: 32 })
  status!: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'CANCELLED';
  /** 数据库记录的启动时间，带时区。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  startedAt!: Date;
  /** 当前执行权的租约到期时间；过期 Worker 不得提交结果。 */
  @Column({ type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;
  /** 当前领取执行权的 Worker UUID；终止或恢复结算后清空。 */
  @Column('uuid', { nullable: true })
  leaseOwner!: string | null;
  /** 越过适配器调用边界前持久化；null 可证明本轮尚未调用工具。 */
  @Column({ type: 'timestamptz', nullable: true })
  invocationStartedAt!: Date | null;

  /** 本轮返回/失联时间；STARTED 为 null，未知结果仍需后续对账。 */
  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;
}
