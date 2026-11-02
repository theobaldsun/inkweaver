/**
 * Agent 知识来源选择：复用既有 RAG 与混合搜索，不复制向量/搜索实现。
 * 所有候选最终再次以 documents.userId + deletedAt 复核，再保存受限来源快照。
 */
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { prepareAgentContext } from './agent-context';
import { AgentSourceStore } from './agent-source.store';
import { RagService } from '../ai/rag.service';
import { SearchService } from '../search/search.service';

import type { AgentContextLimits, AgentContextMessage, AgentPreparedContext } from './agent-context';
import type { AgentRunSource } from './entity/agent-run-source.entity';
import type { SimilarityHit } from '../ai/vector/vector-store';

export interface AgentKnowledgeOptions {
  /** RAG 候选数，默认 8，最多 20。 */
  maxRagHits?: number;
  /** 混合搜索候选数，默认 12，最多 100。 */
  maxSearchHits?: number;
  /** 保存的候选来源数，默认 8，最多 20。 */
  maxSources?: number;
  /** 单片段字符数上限，默认 6000。 */
  maxExcerptChars?: number;
  /** 可选文档范围；省略表示用户文档，空数组表示无文档。 */
  docIds?: string[];
}

export class AgentKnowledgeError extends Error {
  readonly code: 'INVALID_AGENT_KNOWLEDGE_INPUT' | 'AGENT_KNOWLEDGE_UNAVAILABLE';

  constructor(code: AgentKnowledgeError['code']) {
    super(code);
    this.name = 'AgentKnowledgeError';
    this.code = code;
  }
}

interface Candidate {
  docId: string;
  retrievalKind: 'rag' | 'search';
  title: string;
  excerpt: string;
  score: number | null;
}

// 去除搜索引擎返回结果中的高亮标签
function stripSearchMarkup(value: string): string {
  return value.replace(/<\/?(?:mark|b)>/gi, '');
}

function mergeRagCandidate(map: Map<string, Candidate>, hit: SimilarityHit): void {
  const current = map.get(hit.docId);
  if (!current || current.score === null || hit.score > current.score) {
    map.set(hit.docId, { docId: hit.docId, retrievalKind: 'rag', title: hit.title, excerpt: hit.content, score: hit.score });
  }
}

@Injectable()
export class AgentKnowledgeService {
  constructor(
    private readonly ragService: RagService,
    private readonly searchService: SearchService,
    private readonly dataSource: DataSource,
  ) {}

  /** 供 Graph 初始化调用：检索、预算裁剪、记录实际选中来源；system 只能由服务端构造。 */
  async prepare(userId: string, runId: string, input: {
    /** 可信系统规则，不得直接取自文档或客户端。 */
    system: string;
    /** 当前用户目标。 */
    currentUser: string;
    /** 已按归属读取的可见历史，不含隐藏推理。 */
    history: AgentContextMessage[];
    /** 服务端模型预算。 */
    limits: AgentContextLimits;
    /** 可选检索范围与数量限制。 */
    knowledge?: AgentKnowledgeOptions;
  }): Promise<AgentPreparedContext> {
    const candidates = await this.collect(userId, runId, input.currentUser, input.knowledge);
    const context = prepareAgentContext({ ...input, sources: candidates.map((source) => ({
      sourceId: source.id, docId: source.docId, title: source.title,
      excerpt: source.excerpt, documentUpdatedAt: source.documentUpdatedAt,
    })) });
    await new AgentSourceStore(this.dataSource.manager).markContext(userId, runId, context.sources.map((source) => source.sourceId));
    return context;
  }

  /**
   * 并行复用语义 RAG 与混合搜索，按文档合并后再次检查当前用户归属并持久化来源快照。
   * 单路失败允许降级；两路都失败才返回统一不可用错误。
   *
   * 数据流：RAG(topK=8) + 搜索(topK=12) → 合并去重 → 按 score 排序取前 maxSources →
   * 归属复核（查 documents 表确认未删除）→ excerpt 裁剪 → capture 持久化。
   */
  async collect(userId: string, runId: string, query: string, options: AgentKnowledgeOptions = {}): Promise<AgentRunSource[]> {
    // 参数默认值：RAG 取 8 个 chunk、搜索取 12 篇文档、最终合并后保留 8 个来源、摘要不超 6000 字符。
    const maxRagHits = options.maxRagHits ?? 8;
    const maxSearchHits = options.maxSearchHits ?? 12;
    const maxSources = options.maxSources ?? 8;
    const maxExcerptChars = options.maxExcerptChars ?? 6000;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // 参数结构守卫：UUID 格式、query 非空且 ≤8000 字符、各数值参数在合理范围内。
    if (!uuid.test(userId) || !uuid.test(runId)
      || (options.docIds !== undefined && (!Array.isArray(options.docIds) || options.docIds.length > 100 || options.docIds.some((id) => !uuid.test(id))))
      || typeof query !== 'string' || !query.trim() || query.length > 8000
      || !Number.isInteger(maxRagHits) || maxRagHits < 1 || maxRagHits > 20
      || !Number.isInteger(maxSearchHits) || maxSearchHits < 1 || maxSearchHits > 100
      || !Number.isInteger(maxSources) || maxSources < 1 || maxSources > 20
      || !Number.isInteger(maxExcerptChars) || maxExcerptChars < 200 || maxExcerptChars > 20000) {
      throw new AgentKnowledgeError('INVALID_AGENT_KNOWLEDGE_INPUT');
    }

    // 显式传了空 docIds = 限定在 0 篇文档里查 → 直接返回空结果，不走检索。
    if (options.docIds?.length === 0) return new AgentSourceStore(this.dataSource.manager).capture(userId, runId, []);

    // 并行发起两路检索：RAG（向量语义相似）+ 搜索（全文/混合匹配）。
    // 用 Promise.allSettled：任一路失败不阻塞另一路，单路失败可降级；两路都失败才抛错。
    const [ragResult, searchResult] = await Promise.allSettled([
      this.ragService.retrieve(userId, query, { topK: maxRagHits, docIds: options.docIds }),
      this.searchService.hybridSearch(userId, query, 1, maxSearchHits, 'smart'),
    ]);
    if (ragResult.status === 'rejected' && searchResult.status === 'rejected') {
      throw new AgentKnowledgeError('AGENT_KNOWLEDGE_UNAVAILABLE');
    }

    // 合并两路结果到 candidates Map（key = docId）。RAG 结果优先写入，search 结果补充 RAG 没覆盖的文档。
    const candidates = new Map<string, Candidate>();
    if (ragResult.status === 'fulfilled') {
      // mergeRagCandidate 按文档聚合多个 chunk（同一文档的不同片段），取最高相似度。
      for (const hit of ragResult.value) mergeRagCandidate(candidates, hit);
    }
    if (searchResult.status === 'fulfilled') {
      for (const hit of searchResult.value.documents) {
        // 如果限定了 docIds，搜索返回的结果可能包含范围外的文档，需要过滤。
        if (options.docIds?.length && !options.docIds.includes(hit.id)) continue;
        const score = Math.max(0, Math.min(1, hit.score / 100));
        const current = candidates.get(hit.id);
        // 只补充：RAG 已覆盖的文档不覆盖（RAG 语义精度通常更高）。
        if (!current) {
          candidates.set(hit.id, { docId: hit.id, retrievalKind: 'search', title: hit.title,
            excerpt: stripSearchMarkup(hit.excerpt), score });
        }
      }
    }
    // 按 score 降序排列，取前 maxSources；无候选直接返回空。
    const ranked = [...candidates.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, maxSources);
    if (ranked.length === 0) return new AgentSourceStore(this.dataSource.manager).capture(userId, runId, []);

    // 归属复核：检索结果只是"向量索引/搜索引擎"返回的，可能已过期（文档被删或转移归属）。
    // 必须回查 documents 表确认：属于当前用户、未删除。
    const ids = ranked.map((candidate) => candidate.docId);
    const metadata: Array<{ id: string; title: string; updatedAt: Date }> = await this.dataSource.query(
      `SELECT id,title,"updatedAt" FROM documents WHERE "userId"=$1 AND "deletedAt" IS NULL AND id=ANY($2::uuid[])`,
      [userId, ids],
    );
    const byId = new Map(metadata.map((row) => [row.id, row]));
    // 组装最终来源列表：查不到的（已删/不属于当前用户）直接丢弃；excerpt 裁剪到 maxExcerptChars。
    const sources = ranked.flatMap((candidate) => {
      const doc = byId.get(candidate.docId);
      if (!doc) return [];
      // 用 Unicode code point 切片（非字节切片），防止在字符中间截断。
      const excerpt = [...candidate.excerpt].slice(0, maxExcerptChars).join('').trim();
      if (!excerpt) return [];
      return [{
        docId: candidate.docId,
        retrievalKind: candidate.retrievalKind,  // 'rag' | 'search'，用于前端展示来源类型
        title: (doc.title || candidate.title || '无标题文档').slice(0, 500),
        excerpt,
        documentUpdatedAt: new Date(doc.updatedAt),  // 用于后续判断 excerpt 是否可能过期
        score: candidate.score,
      }];
    });
    // 持久化到 agent_run_sources：分配引用标签（S1..S20），供模型生成和引用校验使用。
    return new AgentSourceStore(this.dataSource.manager).capture(userId, runId, sources);
  }
}
