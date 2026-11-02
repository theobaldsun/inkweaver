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

  /**
   * 定向修订目标成果的稳定 UUID。
   *
   * 仅由提交路径依据 revisionTarget 写入，模型不可自行指定；
   * 普通任务（非修订）Run 恒为 null。整稿修订同样携带此字段，
   * 仅其 revisionRange 为 null（见下）。
   *
   * 关键约束：成果版本号是"按成果独立编号"的——每份成果各自
   * 从 v1 递增，彼此互不相干。因此仅凭本字段无法说明"修订自第几版"，
   * 必须叠加 revisionBaseVersion 才能唯一锁定修订起点。
   */
  @Column('uuid', { nullable: true })
  revisionArtifactId!: string | null;

  /**
   * 修订基准版本号；与 revisionArtifactId 同时存在或同时为空。
   *
   * 二者合成为"修订坐标"：(artifactId, baseVersion) 唯一确定
   * 本次修订基于哪份成果的哪一个版本。
   *
   * 提交时本值会被冻结，且必须等于该成果当前最新版本；若不等
   * （例如他人在打开成果后改动了它），提交路径抛出
   * AGENT_ARTIFACT_VERSION_CONFLICT。这样既能防止基于过期底稿
   * 修订、避免静默覆盖他人改动，也保证修订历史可审计——
   * 存下来的基准版本永远指向一份真实存在过的成果快照。
   *
   * 该字段不随成果后续更新自动改变，修订完成后仍指向提交时刻的版本。
   */
  @Column('integer', { nullable: true })
  revisionBaseVersion!: number | null;

  /**
   * 章节（局部）修订的固定 UTF-16 半开区间 [start, end)。
   *
   * 仅当修订类型为"章节修订"时非 null：start 含、end 不含，
   * 单位均为 JavaScript UTF-16 代码单元，避免依赖可能重复的标题。
   * 整稿修订与普通任务均为 null——整稿修订直接替换整份成果，
   * 不需要也不会携带范围。
   *
   * 即使生成内容也不得越过此区间（持久化层 assertRevisionBoundary
   * 二次校验），防止模型改写范围外字符。
   */
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
