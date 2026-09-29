/**
 * agent_runs 的基础字段映射；数据库约束由迁移维护，不启用自动同步。
 * 状态和修订号由 AgentRunStore 显式条件更新，不依赖 save 的自动版本递增。
 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { AgentRevisionRange } from '../agent-revision-range';
import type { AgentRunStatus } from '../agent-run-lifecycle';

@Entity('agent_runs')
export class AgentRun {
  /** 服务端生成的 Run UUID。 */
  @PrimaryColumn('uuid')
  id!: string;

  /** 来自可信认证上下文的用户 UUID。 */
  @Column('uuid')
  userId!: string;

  /** 连续会话 UUID；旧版独立 Run 可为空。 */
  @Column('uuid', { nullable: true })
  threadId!: string | null;

  /** 触发本 Run 的用户消息 UUID；与 threadId 同时为空或同时存在。 */
  @Column('uuid', { nullable: true })
  triggerMessageId!: string | null;

  /** 定向修订的稳定成果 UUID；非修订 Run 为 null，不能由模型指定。 */
  @Column('uuid', { nullable: true })
  revisionArtifactId!: string | null;

  /** 固定的基准版本；与成果 ID 同时存在或为空，不跟随最新版自动改变。 */
  @Column('integer', { nullable: true })
  revisionBaseVersion!: number | null;

  /** 章节修订的固定 UTF-16 半开区间；整稿修订及普通任务为 null。 */
  @Column('jsonb', { nullable: true })
  revisionRange!: AgentRevisionRange | null;

  /** 对话或任务模式，不自行授予工具权限。 */
  @Column({ type: 'varchar', length: 16 })
  mode!: 'dialogue' | 'task';

  /** 整体运行状态，区别于图内步骤和工具调用状态。 */
  @Column({ type: 'varchar', length: 32, default: 'CREATED' })
  status!: AgentRunStatus;

  /** 调度暂停；历史任务默认暂停，显式提交/恢复才允许执行。 */
  @Column({ type: 'boolean', default: true })
  executionPaused!: boolean;

  /** 持久化取消意图；不等于所有在途操作已停止。 */
  @Column({ type: 'boolean', default: false })
  cancelRequested!: boolean;

  /** 稳定错误代码，不保存供应商响应或用户正文。 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  lastErrorCode!: string | null;

  /** 下一次可调度时间；用于退避而非精确定时任务。 */
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  nextDispatchAt!: Date;

  /** 用户目标，属于私人内容，不写入诊断日志。 */
  @Column('text')
  goal!: string;

  /** 创建时固定的工作流版本。 */
  @Column({ type: 'varchar', length: 128 })
  workflowVersion!: string;

  /** 非负修订号，每次成功状态更新增加 1。 */
  @Column({ type: 'integer', default: 0 })
  revision!: number;

  /** 数据库创建时间，包含时区。 */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  /** 最后成功状态更新的数据库时间，包含时区。 */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
