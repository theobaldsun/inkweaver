/**
 * 事件历史分页读取；使用可信用户身份过滤，不提供跨用户事件查询。
 * 不负责 SSE 订阅或保留期缺口恢复；空页不代表 Run 已结束。
 */
import { parseAgentEventBody } from './agent-event';

import type { AgentEventBody } from './agent-event';

export interface AgentEventRecord {
  /** 服务端事件 UUID。 */
  id: string;
  /** 所属 Run UUID。 */
  runId: string;
  /** Run 内事件序号，不是 Run revision。 */
  sequence: number;
  /** 数据库时间的 ISO 8601 表达。 */
  createdAt: string;
  /** 经过当前协议校验的独立正文。 */
  body: AgentEventBody;
}

export interface AgentEventPage {
  /** 按序号升序排列的事件。 */
  events: AgentEventRecord[];
  /** 下一次查询的排他游标；空页保持原值。 */
  nextAfter: number;
  /** 此次查询是否看到了更多记录，不表示后续不会产生新事件。 */
  hasMore: boolean;
}

export class AgentEventReader {
  /** 由上层提供已配置的数据访问入口，本类不初始化连接。 */
  constructor(private readonly manager: { query(sql: string, parameters: unknown[]): Promise<unknown> }) {}

  /**
   * 查询 sequence > after，最多返回 limit 条（1～100）；多取一条判断是否有下一页。
   * 无权、不存在及暂无事件均返回空页；API 层若需 Run 状态，须另行按归属查询。
   */
  async list(userId: string, runId: string, after = 0, limit = 50): Promise<AgentEventPage> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if ([userId, runId].some((id) => typeof id !== 'string' || !uuid.test(id))
      || !Number.isInteger(after) || after < 0 || after > 2147483647
      || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_AGENT_EVENT_QUERY');
    const rows = await this.manager.query(`SELECT e.id, e."runId", e.sequence, e."createdAt", e.type, e."schemaVersion", e.payload
        FROM agent_events e INNER JOIN agent_runs r ON r.id = e."runId" AND r."userId" = e."userId"
        WHERE r."userId" = $1 AND r.id = $2 AND e.sequence > $3
        ORDER BY e.sequence ASC LIMIT $4`, [userId, runId, after, limit + 1]) as {
          id: string; runId: string; sequence: number; createdAt: Date; type: unknown; schemaVersion: unknown; payload: unknown;
        }[];
    // 不跳过无法识别的正文，否则客户端可能越过该序号，永久遗漏事件。
    const events = rows.slice(0, limit).map((row) => ({
      id: row.id, runId: row.runId, sequence: row.sequence, createdAt: row.createdAt.toISOString(),
      body: parseAgentEventBody({ type: row.type, schemaVersion: row.schemaVersion, payload: row.payload }),
    }));
    return { events, nextAfter: events.at(-1)?.sequence ?? after, hasMore: rows.length > limit };
  }
}
