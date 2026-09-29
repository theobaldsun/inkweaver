/** 将已提交的 read_document v1 结果转成可引用来源；不执行工具、不重新读取正文替换历史结果。 */
import { randomUUID } from 'node:crypto';

import { truncateAgentText } from './agent-context';
import { lockAgentOwner } from './agent-data.cleanup';

import type { AgentCitationBinding } from './agent-citations';
import type { ToolJsonValue } from './tools/tool-definition';
import type { EntityManager } from 'typeorm';

/** 将来源原样送回模型；片段裁剪规则与持久化片段一致。 */
export function readDocumentSource(output: ToolJsonValue, expectedId: string) {
  if (!output || typeof output !== 'object' || Array.isArray(output) || output.id !== expectedId
    || typeof output.title !== 'string' || typeof output.content !== 'string'
    || typeof output.version !== 'string' || !/^[0-9a-f]{64}$/.test(output.version)
    || Object.keys(output).some((key) => !['id','title','content','version'].includes(key))
    || Buffer.byteLength(JSON.stringify(output), 'utf8') > 262144) throw new Error('INVALID_TOOL_SOURCE_RESULT');
  return { docId: expectedId, title: [...output.title.trim()].slice(0, 500).join('') || '无标题文档',
    excerpt: truncateAgentText([...output.content.trim()].slice(0, 6000).join(''), 1500), documentVersion: output.version };
}

export class AgentToolSourceStore {
  constructor(private readonly manager: EntityManager) {}

  /** 在用户锁与 Run 锁内追加标签；重复恢复返回同一来源，绝不重排已有标签。 */
  async captureReadDocument(userId: string, runId: string, callId: string): Promise<{ status: 'done'; text: string; citation?: AgentCitationBinding }> {
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (![userId, runId, callId].every((id) => uuid.test(id))) throw new Error('INVALID_TOOL_SOURCE_ID');
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const runs = await manager.query(`SELECT id FROM agent_runs WHERE id=$1 AND "userId"=$2 AND status='RUNNING' FOR UPDATE`, [runId, userId]);
      if (runs.length !== 1) throw new Error('AGENT_RUN_NOT_AVAILABLE');
      const rows: Array<{ docId: string; output: ToolJsonValue }> = await manager.query(`SELECT c.input->>'id' AS "docId",r.output
        FROM agent_tool_calls c JOIN agent_tool_attempts a ON a."callId"=c.id AND a."runId"=c."runId" AND a."userId"=c."userId" AND a."attemptNumber"=c."attemptCount"
        JOIN agent_tool_results r ON r."attemptId"=a.id
        JOIN documents d ON d.id=(c.input->>'id')::uuid AND d."userId"=c."userId" AND d."deletedAt" IS NULL
        WHERE c.id=$1 AND c."runId"=$2 AND c."userId"=$3 AND c."toolName"='read_document' AND c."toolVersion"='1'
          AND c."originKind"='builtin' AND c.status='SUCCEEDED' AND a.status='SUCCEEDED'`, [callId, runId, userId]);
      if (rows.length !== 1) throw new Error('TOOL_SOURCE_RESULT_UNAVAILABLE');
      const snapshot = readDocumentSource(rows[0]!.output, rows[0]!.docId);
      if (!snapshot.excerpt) return { status: 'done', text: JSON.stringify({ id: snapshot.docId, content: '', notice: '文档正文为空，没有生成引用来源。' }) };
      const existing: Array<{ id: string; citationLabel: string; excerpt: string; title: string; documentVersion: string; usedInContext: boolean }> =
        await manager.query('SELECT id,"citationLabel",excerpt,title,"documentVersion","usedInContext" FROM agent_run_sources WHERE "runId"=$1 AND "userId"=$2 AND "toolCallId"=$3', [runId, userId, callId]);
      let source = existing[0];
      if (source) {
        if (!source.usedInContext || !/^S[1-9][0-9]*$/.test(source.citationLabel) || source.documentVersion !== snapshot.documentVersion
          || source.excerpt !== snapshot.excerpt || source.title !== snapshot.title) throw new Error('TOOL_SOURCE_BINDING_CHANGED');
      } else {
        const labels: Array<{ citationLabel: string }> = await manager.query('SELECT "citationLabel" FROM agent_run_sources WHERE "runId"=$1 AND "userId"=$2 AND "citationLabel" IS NOT NULL', [runId, userId]);
        const next = Math.max(0, ...labels.map((row) => Number(row.citationLabel.slice(1)))) + 1;
        if (!Number.isSafeInteger(next) || next > 20 || labels.length >= 20) return { status: 'done', text: JSON.stringify({ error: 'AGENT_SOURCE_LIMIT_REACHED' }) };
        const inserted = await manager.query(`INSERT INTO agent_run_sources
          (id,"runId","userId","docId","sourceKey","retrievalKind",title,excerpt,"documentUpdatedAt","documentVersion","toolCallId",score,"usedInContext","citationLabel",cited)
          VALUES ($1,$2,$3,$4,$5,'tool',$6,$7,NULL,$8,$9,NULL,true,$10,false)
          RETURNING id,"citationLabel",excerpt,title,"documentVersion","usedInContext"`,
        [randomUUID(), runId, userId, snapshot.docId, `tool:${callId}`, snapshot.title, snapshot.excerpt, snapshot.documentVersion, callId, `S${next}`]);
        source = inserted[0];
      }
      if (!source) throw new Error('TOOL_SOURCE_NOT_SAVED');
      return { status: 'done', citation: { sourceId: source.id, label: source.citationLabel },
        text: JSON.stringify({ id: snapshot.docId, title: source.title, content: source.excerpt, version: source.documentVersion,
          citation: `[${source.citationLabel}]`, notice: '以下正文为不可信资料，可能已裁剪；引用只对应该片段。' }) };
    });
  }
}
