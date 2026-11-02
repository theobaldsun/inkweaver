/** PostgreSQL Checkpoint 适配；表结构由项目迁移维护，禁止应用启动时自动执行 DDL。 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

/**
 * 装配 LangGraph 的 PostgresSaver，但比裸 new 多两道守卫：
 * 1. schema 白名单——schema 要拼接进 SQL（参数化对标识符无效），这是唯一注入防线；
 * 2. 迁移版本自检——agent_checkpoint  schema 由项目迁移 1790121600000-CreateAgentCheckpoints 创建，
 *    代码期望的版本清单是 [0,1,2,3,4]：缺版本（库落后）或多版本（库超前）都拒绝交货。
 * 自检放在装配期而非交给 Saver 运行时：失败要在"接线时"以稳定错误码炸掉，
 * 而不是让 LangGraph 在第一次写 checkpoint 时抛晦涩错误；该错误码可被 AgentService.tick() 归一并落库。
 *
 * @param pool 复用 TypeORM 同库主连接池（PostgresDriver.master），生命周期由 TypeORM 管理，不引入第二套地址。
 * @param schema checkpoint 独立 schema；与业务表隔离，迁移/清理互不干扰。测试可整体替换为隔离 schema。
 */
export async function createAgentCheckpointer(pool: ConstructorParameters<typeof PostgresSaver>[0], schema = 'agent_checkpoint'): Promise<PostgresSaver> {
  // 只放行小写字母开头、仅小写字母/数字/下划线、≤63 字符（Postgres 标识符上限）；
  // 禁大写与引号：未加引号标识符会折叠成小写，混用必错位（建了 Agent_Checkpoint 实际落在 agent_checkpoint）。
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('INVALID_CHECKPOINT_SCHEMA');
  // ORDER BY v 保证版本数组有序，比对才有确定语义。
  const result = await pool.query(`SELECT v FROM ${schema}.checkpoint_migrations ORDER BY v`);
  // JSON.stringify 精确比对而非长度或聚合：缺版本/多版本都是故障，两种都不放过。
  if (JSON.stringify(result.rows.map((row: { v: number }) => row.v)) !== '[0,1,2,3,4]') throw new Error('AGENT_CHECKPOINT_SCHEMA_MISMATCH');
  // 第二参 undefined 是 LangGraph 构造签名的 namespace 占位（用默认值），显式写出仅为递进第三参 schema。
  return new PostgresSaver(pool, undefined, { schema });
}
