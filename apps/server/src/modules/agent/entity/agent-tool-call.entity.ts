/**
 * agent_tool_calls 的字段映射；组合外键、CHECK 和索引由既有迁移维护，禁止自动同步。
 * 实体不验证授权，不执行工具；状态、尝试次数和 revision 需由后续服务条件更新。
 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { ToolCallLifecycle } from '../tools/tool-call-lifecycle';
import type { ToolOrigin } from '../tools/tool-definition';

@Entity('agent_tool_calls')
export class AgentToolCall implements ToolCallLifecycle {
  /** 服务端生成的逻辑调用 UUID，不是单次执行 attemptId。 */
  @PrimaryColumn('uuid')
  id!: string;

  /** 所属 Run UUID。 */
  @Column('uuid')
  runId!: string;

  /** 必须与 Run 归属一致的用户 UUID。 */
  @Column('uuid')
  userId!: string;

  /** Run 内稳定去重键，重复投递复用；不是执行成功保证。 */
  @Column({ type: 'varchar', length: 128 })
  callKey!: string;

  /** 创建调用时固定的工具名称。 */
  @Column('text')
  toolName!: string;

  /** 创建调用时固定的工具版本，不随注册表更新。 */
  @Column('text')
  toolVersion!: string;

  /** 固定来源类型，区别内置与 MCP 适配器。 */
  @Column({ type: 'varchar', length: 16 })
  originKind!: ToolOrigin['kind'];

  /** 内置工具为 null；MCP 为服务端连接 ID，不能存地址或凭据。 */
  @Column({ type: 'text', nullable: true })
  connectionId!: string | null;

  /** JSON 对象参数快照，属于用户私人数据；服务层须校验为工具 JSON，ORM 映射不承担运行时校验。 */
  @Column('jsonb')
  input!: Record<string, unknown>;

  /** 逻辑调用状态，与 Run 状态分别管理。 */
  @Column({ type: 'varchar', length: 32, default: 'PREPARED' })
  status!: ToolCallLifecycle['status'];

  /** 整个逻辑调用的已知副作用；未知结果不能当作未执行。 */
  @Column({ type: 'varchar', length: 16, default: 'none' })
  sideEffect!: ToolCallLifecycle['sideEffect'];

  /** 已启动执行尝试次数，不替代独立尝试记录。 */
  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  /** 是否需要确认；无默认值，必须由可信准备流程明确提供。 */
  @Column('boolean')
  requiresConfirmation!: boolean;

  /** 取消意图，不代表执行已停止或副作用已撤销。 */
  @Column({ type: 'boolean', default: false })
  cancelRequested!: boolean;

  /** RETRY_WAIT 的数据库时钟退避截止时间；其他状态应为 null。 */
  @Column({ type: 'timestamptz', nullable: true })
  retryNotBefore!: Date | null;

  /** 非负并发修订号，持久化更新时显式比较并递增。 */
  @Column({ type: 'integer', default: 0 })
  revision!: number;

  /** 创建时间，包含时区，由数据库生成。 */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  /** 最后更新时间，后续服务显式维护，不依赖 save 自动更新。 */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
