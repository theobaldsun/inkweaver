/** PostgreSQL Checkpoint 适配；表结构由项目迁移维护，禁止应用启动时自动执行 DDL。 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

/** 复用 AgentService 所用 TypeORM 数据源的连接池，其生命周期由 TypeORM 管理；不从请求取连接配置。 */
export async function createAgentCheckpointer(pool: ConstructorParameters<typeof PostgresSaver>[0], schema = 'agent_checkpoint'): Promise<PostgresSaver> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('INVALID_CHECKPOINT_SCHEMA');
  const result = await pool.query(`SELECT v FROM ${schema}.checkpoint_migrations ORDER BY v`);
  if (JSON.stringify(result.rows.map((row: { v: number }) => row.v)) !== '[0,1,2,3,4]') throw new Error('AGENT_CHECKPOINT_SCHEMA_MISMATCH');
  return new PostgresSaver(pool, undefined, { schema });
}
