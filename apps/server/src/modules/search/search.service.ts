/**
 * 搜索服务。
 *
 * 用途：
 * - 维护用户搜索历史（增删查清空）
 * - 实现四路混合检索：精确匹配 / 全文模糊 / 关联召回 / 语义向量
 * - 文档级加权融合排序，支持 smart / keyword / semantic 三种模式
 *
 * 数据来源：
 * - `search_history` 表：用户搜索关键词历史
 * - `documents` 表：精确/全文/关联三通道
 * - `document_chunks` 表：语义向量通道（经 PgVectorStore.semanticSearchForHybrid）
 *
 * 关键策略：
 * - 四路并行召回，单路失败 .catch 降级返回 []，不拖垮融合
 * - Map<docId, MergedDocScore> 合并，docId 唯一保证跨页不重复
 * - 加权求和 + recencyBonus（最近 7 天更新 +5 分上限）
 * - 权重当前 hardcode，T4 后迁配置表
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { SearchHistory } from './entity/search-history.entity';
import { EmbeddingClient } from '../ai/embedding.client';
import { VectorStore } from '../ai/vector/vector-store';
import { VECTOR_STORE } from '../ai/vector/vector-store.token';
import { Document } from '../documents/entity/document.entity';

/** 通道命中标记，供前端打标签 [精确命中标题] [语义匹配] */
type Channel = 'exact' | 'fuzzy' | 'related' | 'semantic';

/** 文档级合并分数（docId 为唯一键，融合阶段中间结构） */
interface MergedDocScore {
  /** 文档 ID（融合唯一键） */
  docId: string;
  /** 四路通道分数（0 表示未命中或失败降级） */
  scores: Record<Channel, number>;
  /** 命中通道集合，供前端打标签 */
  matched: Set<Channel>;
  /** 元数据，excerpt 优先级：精确→模糊→语义→正文前 50 字 */
  meta: { title?: string; excerpt?: string; lastOpenedAt?: Date | null; similarity?: number; tags?: string[]; updatedAt?: string };
  /** 距上次更新天数，用于 recencyBonus 计算 */
  daysAgo: number;
}

/** Step 0 抽取的结构化实体，缺省值让对应条件不贡献分数 */
interface SearchEntities {
  /** 关键词中匹配到的年份（如 2024），null 表示未匹配 */
  year: number | null;
  /** 关键词中匹配到的月份（1-12），null 表示未匹配 */
  month: number | null;
  /** 分词后的关键词，用于 tags 数组包含匹配 */
  tags: string[];
  /** 当前页 folderId，用于关联召回同文件夹加分 */
  folderId: string | null;
}

/** 关联召回上下文（当前页 folderId 等，T3 前端可传） */
export interface SearchContext {
  folderId?: string | null;
}

/** hybridSearch 返回的单条结果 */
export interface HybridSearchHit {
  /** 文档 ID */
  id: string;
  /** 文档标题 */
  title: string;
  /** 带 <b> 高亮的 HTML 摘要（ts_headline 产物已转义安全） */
  excerpt: string;
  /** 匹配度 0~100（按当前页最高分归一化） */
  score: number;
  /** 命中通道列表，供前端打标签 */
  matchedBy: Channel[];
  /** 文档更新时间（ISO 字符串） */
  updatedAt: string;
  /** 文档标签数组 */
  tags: string[];
}

/** hybridSearch 返回结构 */
export interface HybridSearchResult {
  /** 当前页文档列表 */
  documents: HybridSearchHit[];
  /** 总匹配数（非某路 LIMIT 上限） */
  total: number;
  /** 当前页码（从 1 开始） */
  page: number;
  /** 每页数量（1~100，已 clamp） */
  pageSize: number;
  /** 是否还有下一页 */
  hasMore: boolean;
  /** 是否触发召回上限截断，提示用户加关键词缩小范围 */
  truncated: boolean;
}

/** 加权常量（对应设计文档第 8 节问题 3 选 A：T1-T3 阶段 hardcode，T4 后迁配置表） */
const WEIGHTS = { exact: 1.0, fuzzy: 0.8, related: 0.5, semantic: 0.9, recency: 0.05 } as const;
/** 每路多取 1 条用于精确判断是否发生候选截断。 */
const MAX_SEARCH_CANDIDATES = 3000;

@Injectable()
export class SearchService {
  /** 记录单路召回降级，避免 SQL 或外部服务错误被静默吞掉。 */
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectRepository(SearchHistory)
    private searchHistoryRepository: Repository<SearchHistory>,
    @InjectRepository(Document)
    private documentsRepository: Repository<Document>,
    @InjectDataSource()
    private dataSource: DataSource,
    private readonly embeddingClient: EmbeddingClient,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
  ) {}

  // ============ 历史方法（扩展 mode，兼容旧调用方）============
  async addSearchHistory(
    userId: string,
    keyword: string,
    mode: 'smart' | 'keyword' | 'semantic' = 'smart',
  ): Promise<SearchHistory> {
    const rows: SearchHistory[] = await this.searchHistoryRepository.query(
      `INSERT INTO search_history ("userId", keyword, count, mode, "createdAt", "updatedAt")
       VALUES ($1, $2, 1, $3, NOW(), NOW())
       ON CONFLICT ("userId", keyword)
       DO UPDATE SET count = search_history.count + 1,
                     mode = EXCLUDED.mode,
                     "updatedAt" = NOW()
       RETURNING *`,
      [userId, keyword, mode],
    );
    return this.searchHistoryRepository.create(rows[0]!);
  }
  async getSearchHistory(userId: string, limit: number = 10): Promise<SearchHistory[]> {
    return this.searchHistoryRepository.find({ where: { userId }, order: { updatedAt: 'DESC' }, take: limit });
  }
  async deleteSearchHistory(userId: string, keyword: string): Promise<void> {
    await this.searchHistoryRepository.delete({ userId, keyword });
  }
  async clearSearchHistory(userId: string): Promise<void> {
    await this.searchHistoryRepository.delete({ userId });
  }

  // ============ Step 0：query 预处理 ============

  /** 分词：按空格切分 + 基础停用词过滤 */
  private tokenize(keyword: string): string[] {
    const STOP = new Set(['的', '了', '和', '与', '在', '是', '我', '有', 'a', 'the', 'of']);
    return keyword
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !STOP.has(t.toLowerCase()));
  }

  /**
   * 实体抽取：正则硬匹配年份/月份（对应设计文档第 8 节问题 1 选 A）。
   * 无对应实体返回 null，调用方传"不可能命中值"让条件不贡献。
   */
  private extractEntities(keyword: string, context: SearchContext): SearchEntities {
    const yearMatch = keyword.match(/(19|20)\d{2}年?/);
    const monthMatch = keyword.match(/\b(\d{1,2})\s*[月份]\b/) ?? keyword.match(/(\d{1,2})月份?/);
    const year = yearMatch ? Number(yearMatch[0].replace('年', '')) : null;
    let month: number | null = null;
    if (monthMatch) {
      const m = Number(monthMatch[1]);
      if (m >= 1 && m <= 12) month = m;
    }
    const tags = this.tokenize(keyword).filter((t) => t.length <= 50);
    return { year, month, tags, folderId: context.folderId ?? null };
  }

  // ============ 四路通道 ============

  /** 通道① 精确匹配：title = keyword 100 分 / ILIKE 95 / tags 包含全部 token 90 */
  private async searchExact(
    userId: string,
    keyword: string,
    tokens: string[],
  ): Promise<Array<{ docId: string; title: string; exactScore: number; exactHint: string }>> {
    const tagScore = tokens.length > 0
      ? `WHEN tags @> to_jsonb($3::varchar[]) THEN 90`
      : '';
    const tagFilter = tokens.length > 0
      ? `OR tags @> to_jsonb($3::varchar[])`
      : '';
    const rows = await this.dataSource.query(
      `SELECT id AS "docId", title,
          CASE
            WHEN title = $2 THEN 100
            WHEN title ILIKE $2 THEN 95
            ${tagScore}
            ELSE 0 END AS "exactScore",
          '命中标题' AS "exactHint"
       FROM documents
       WHERE "userId" = $1 AND "deletedAt" IS NULL
         AND (title = $2 OR title ILIKE $2 ${tagFilter})
       ORDER BY "exactScore" DESC, id ASC
       LIMIT ${MAX_SEARCH_CANDIDATES + 1}`,
      tokens.length > 0 ? [userId, keyword, tokens] : [userId, keyword],
    );
    return rows.map((r: Record<string, unknown>) => ({
      docId: r.docId as string,
      title: r.title as string,
      exactScore: Number(r.exactScore),
      exactHint: r.exactHint as string,
    }));
  }

  /** 通道② 全文模糊：ts_rank_cd 归一化到 0~80，ts_headline 生成带高亮 excerpt */
  private async searchFuzzy(
    userId: string,
    keyword: string,
  ): Promise<Array<{ docId: string; excerpt: string; fuzzyScore: number; matchedTermCount: number }>> {
    const rows = await this.dataSource.query(
      `SELECT id AS "docId",
          ts_headline('simple', title, plainto_tsquery('simple', $2), 'StartSel=<mark>, StopSel=</mark>') AS excerpt,
          ts_rank_cd("docTsv", plainto_tsquery('simple', $2)) * 80 AS "fuzzyScore",
          cardinality(
            ARRAY(
              SELECT unnest(tsvector_to_array("docTsv"))
              INTERSECT
              SELECT unnest(tsvector_to_array(to_tsvector('simple', $2)))
            )
          ) AS "matchedTermCount"
       FROM documents
       WHERE "userId" = $1 AND "deletedAt" IS NULL
         AND "docTsv" @@ plainto_tsquery('simple', $2)
       ORDER BY "fuzzyScore" DESC
       LIMIT ${MAX_SEARCH_CANDIDATES + 1}`,
      [userId, keyword],
    );
    return rows.map((r: Record<string, unknown>) => ({
      docId: r.docId as string,
      excerpt: r.excerpt as string,
      fuzzyScore: Number(r.fuzzyScore),
      matchedTermCount: Number(r.matchedTermCount ?? 0),
    }));
  }

  /**
   * 通道③ 关联召回：年份/月份/标签/文件夹/最近打开 各维度加分。
   *
   * SQL 用子查询过滤 relatedScore > 0，避开 HAVING 无 GROUP BY 的语义歧义。
   * 5 个 CASE 加分维度：年份(+10) / 月份(+10) / 标签命中(+10) / 同文件夹(+15) / 最近 7 天打开过(+20)。
   * 无实体的维度传不可能命中值，让对应 CASE 不贡献分数。
   */
  private async searchRelated(
    userId: string,
    e: SearchEntities,
  ): Promise<Array<{ docId: string; relatedScore: number }>> {
    // 无实体时传不可能命中值，让对应 CASE 不贡献分数
    const year = e.year ?? 0;
    const month = e.month ?? 0;
    const tags = e.tags.length ? e.tags : ['__none__'];
    const folderId = e.folderId ?? '00000000-0000-0000-0000-000000000000';
    const rows = await this.dataSource.query(
      `SELECT "docId", "relatedScore"
       FROM (
         SELECT id AS "docId",
           (CASE WHEN EXTRACT(YEAR FROM "createdAt") = $3::int THEN 10 ELSE 0 END
            + CASE WHEN EXTRACT(MONTH FROM "createdAt") = $4::int THEN 10 ELSE 0 END
            + CASE WHEN tags ?| $5::varchar[] THEN 10 ELSE 0 END
            + CASE WHEN "folderId" = $6::uuid THEN 15 ELSE 0 END
            + CASE WHEN "lastOpenedAt" > NOW() - INTERVAL '7 days' THEN 20 ELSE 0 END
           ) AS "relatedScore"
         FROM documents
         WHERE "userId" = $1 AND "deletedAt" IS NULL
       ) t
       WHERE "relatedScore" > 0
       ORDER BY "relatedScore" DESC
       LIMIT ${MAX_SEARCH_CANDIDATES + 1}`,
      [userId, null, year, month, tags, folderId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      docId: r.docId as string,
      relatedScore: Number(r.relatedScore),
    }));
  }

  /** 通道④ 语义向量：embedQuery → semanticSearchForHybrid，分数 = sim*80 */
  private async searchSemantic(
    userId: string,
    keyword: string,
  ): Promise<Array<{ docId: string; excerpt: string; semanticScore: number; similarity: number }>> {
    const queryEmbedding = await this.embeddingClient.embedQuery(keyword);
    const hits = await this.vectorStore.semanticSearchForHybrid(userId, queryEmbedding);
    return hits.map((h) => ({
      docId: h.docId,
      excerpt: h.excerpt,
      similarity: h.sim,
      semanticScore: h.sim * 80,
    }));
  }

  /**
   * 候选被截断时单独计算未截断的文档级并集总数。
   * 这里只计数，不加载正文或分数；语义通道以 VectorStore 实际返回的候选集合为准。
   */
  private async countHybridMatches(
    userId: string,
    keyword: string,
    tokens: string[],
    entities: SearchEntities,
    mode: 'smart' | 'keyword' | 'semantic',
    semanticDocIds: string[],
  ): Promise<number> {
    const params: unknown[] = [userId];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const keywordRef = bind(keyword);
    const conditions = [
      `title = ${keywordRef}`,
      `title ILIKE ${keywordRef}`,
    ];
    const tokensRef = tokens.length > 0 ? bind(tokens) : null;
    if (tokensRef) conditions.push(`tags @> to_jsonb(${tokensRef}::varchar[])`);
    if (mode !== 'semantic') {
      conditions.push(`"docTsv" @@ plainto_tsquery('simple', ${keywordRef})`);
    }
    if (mode === 'smart') {
      if (entities.year !== null) {
        conditions.push(`EXTRACT(YEAR FROM "createdAt") = ${bind(entities.year)}::int`);
      }
      if (entities.month !== null) {
        conditions.push(`EXTRACT(MONTH FROM "createdAt") = ${bind(entities.month)}::int`);
      }
      if (tokensRef) conditions.push(`tags ?| ${tokensRef}::varchar[]`);
      if (entities.folderId) conditions.push(`"folderId" = ${bind(entities.folderId)}::uuid`);
      conditions.push(`"lastOpenedAt" > NOW() - INTERVAL '7 days'`);
    }
    if (mode !== 'keyword' && semanticDocIds.length > 0) {
      conditions.push(`id = ANY(${bind(semanticDocIds)}::uuid[])`);
    }

    const rows: Array<{ hybridTotal: string | number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS "hybridTotal"
       FROM documents
       WHERE "userId" = $1 AND "deletedAt" IS NULL
         AND (${conditions.join(' OR ')})`,
      params,
    );
    return Number(rows[0]?.hybridTotal ?? 0);
  }

    /**
   * 四路并行召回 + 文档级加权融合排序。
   *
   * 策略：
   * 1. Step 0 预处理（分词 + 实体抽取）
   * 2. 四路 Promise.all 并行（每路 .catch 降级返回 []，单路失败不拖垮融合）
   * 3. Map<docId, MergedDocScore> 合并，docId 唯一保证跨页不重复
   * 4. 加权求和 + recencyBonus（最近 7 天更新 +5 分上限）
   * 5. 排序 + slice 分页 + populateDocMetadata 补全元数据
   *
   * @param mode smart=四路融合 / keyword=只 exact+fuzzy / semantic=exact+semantic
   */
  async hybridSearch(
    userId: string,
    keyword: string,
    page: number,
    pageSize: number,
    mode: 'smart' | 'keyword' | 'semantic' = 'smart',
    context: SearchContext = {},
  ): Promise<HybridSearchResult> {
    // 参数 clamp（与现有 searchDocuments 一致：page≥1，pageSize 1~100）
    page = Math.max(1, Math.floor(page));
    pageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));

    const tokens = this.tokenize(keyword);
    const entities = this.extractEntities(keyword, context);


    // 1. 按 mode 过滤通道（keyword 模式丢弃 semantic/related；semantic 模式丢弃 fuzzy/related）
    const useExact = true;
    const useFuzzy = mode !== 'semantic';
    const useRelated = mode === 'smart';
    const useSemantic = mode !== 'keyword';

    // 2. 四路并行；单路异常会记录通道名称并降级为空，不拖垮其余结果。
    const [exactCandidates, fuzzyCandidates, relatedCandidates, semanticCandidates] = await Promise.all([
      useExact
        ? this.runChannel('exact', () => this.searchExact(userId, keyword, tokens))
        : Promise.resolve([]),
      useFuzzy
        ? this.runChannel('fuzzy', () => this.searchFuzzy(userId, keyword))
        : Promise.resolve([]),
      useRelated
        ? this.runChannel('related', () => this.searchRelated(userId, entities))
        : Promise.resolve([]),
      useSemantic
        ? this.runChannel('semantic', () => this.searchSemantic(userId, keyword))
        : Promise.resolve([]),
    ]);
    const candidateTruncated = [
      exactCandidates,
      fuzzyCandidates,
      relatedCandidates,
      semanticCandidates,
    ].some((rows) => rows.length > MAX_SEARCH_CANDIDATES);
    const exact = exactCandidates.slice(0, MAX_SEARCH_CANDIDATES);
    const fuzzy = fuzzyCandidates.slice(0, MAX_SEARCH_CANDIDATES);
    const related = relatedCandidates.slice(0, MAX_SEARCH_CANDIDATES);
    const semantic = semanticCandidates.slice(0, MAX_SEARCH_CANDIDATES);

    // 3. Map<docId, MergedDocScore> 合并
    const merged = new Map<string, MergedDocScore>();
    const addScore = (
      docId: string,
      channel: Channel,
      score: number,
      meta: MergedDocScore['meta'],
    ) => {
      let entry = merged.get(docId);
      if (!entry) {
        entry = { docId, scores: { exact: 0, fuzzy: 0, related: 0, semantic: 0 }, matched: new Set(), meta: {}, daysAgo: 0 };
        merged.set(docId, entry);
      }
      entry.scores[channel] = score;
      if (score > 0) entry.matched.add(channel);
      Object.assign(entry.meta, meta);
    };

    exact.forEach((r) => addScore(r.docId, 'exact', r.exactScore, { title: r.title }));
    fuzzy.forEach((r) => addScore(r.docId, 'fuzzy', r.fuzzyScore, { excerpt: r.excerpt }));
    related.forEach((r) => addScore(r.docId, 'related', r.relatedScore, {}));
    semantic.forEach((r) => addScore(r.docId, 'semantic', r.semanticScore, { excerpt: r.excerpt, similarity: r.similarity }));

    // 4. 加权求和（recencyBonus 用 daysAgo 算，daysAgo 由 populateDocMetadata 补全）
    const scorer = (m: MergedDocScore) => {
      const daysSinceUpdate = m.daysAgo;
      // 最近 7 天更新 +5 分上限，30 天后不加成
      const recencyBonus = Math.max(0, 5 - daysSinceUpdate / 6);
      return (
        WEIGHTS.exact * m.scores.exact +
        WEIGHTS.fuzzy * m.scores.fuzzy +
        WEIGHTS.related * m.scores.related +
        WEIGHTS.semantic * m.scores.semantic +
        WEIGHTS.recency * recencyBonus
      );
    };

    // 5. 先补 updatedAt/daysAgo 再排序（recencyBonus 依赖它）
    const allDocs = await this.populateDocMetadata([...merged.values()], userId);
    allDocs.sort((a, b) => scorer(b) - scorer(a));

    const total = candidateTruncated
      ? await this.countHybridMatches(
          userId,
          keyword,
          tokens,
          entities,
          mode,
          semanticCandidates.map((candidate) => candidate.docId),
        )
      : allDocs.length;
    const start = (page - 1) * pageSize;
    const pageDocs = allDocs.slice(start, start + pageSize);
    const maxScore = pageDocs.length > 0 ? scorer(pageDocs[0]!) : 1;

    const documents: HybridSearchHit[] = pageDocs.map((m) => ({
      id: m.docId,
      title: m.meta.title ?? '',
      excerpt: m.meta.excerpt ?? '',
      score: maxScore > 0 ? Math.round((scorer(m) / maxScore) * 100) : 0,
      matchedBy: [...m.matched],
      updatedAt: m.meta.updatedAt ?? new Date().toISOString(),
      tags: m.meta.tags ?? [],
      recentlyOpen: m.meta.lastOpenedAt ? m.meta.lastOpenedAt.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000 : false,
    }));

    return {
      documents,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < allDocs.length,
      truncated: candidateTruncated,
    };
  }

  /**
   * 补全文档元数据：title / updatedAt / tags / excerpt 选择。
   *
   * excerpt 优先级：精确命中标题 → 模糊 ts_headline → 语义分块 excerpt → 正文前 50 字
   * 批量查元数据，避免 N+1。
   *
   * 不再额外过滤 deletedAt：候选 docId 来自四路通道，通道 SQL 都已带
   * `deletedAt IS NULL`，重复过滤会拖慢查询；docId 在召回时已是未删除状态。
   */
  private async populateDocMetadata(
    docs: MergedDocScore[],
    userId: string,
  ): Promise<MergedDocScore[]> {
    if (docs.length === 0) return docs;
    const ids = docs.map((d) => d.docId);
    // 用 In 算子一次查询，避免 N+1
    const meta = await this.documentsRepository.find({
      where: { id: In(ids), userId },
      select: ['id', 'title', 'content', 'tags', 'updatedAt', 'lastOpenedAt'],
    });
    const metaMap = new Map(meta.map((d) => [d.id, d]));
    const now = Date.now();
    return docs.map((d) => {
      const m = metaMap.get(d.docId);
      if (m) {
        d.meta.title = d.meta.title ?? m.title;
        d.meta.tags = m.tags ?? [];
        d.meta.updatedAt = m.updatedAt.toISOString();
        d.daysAgo = Math.floor((now - m.updatedAt.getTime()) / 86400000);
        d.meta.lastOpenedAt = m.lastOpenedAt;
        // excerpt 优先级兜底：正文前 50 字
        if (!d.meta.excerpt) {
          const text = (m.content || '').replace(/<[^>]*>/g, '').slice(0, 50);
          d.meta.excerpt = text;
        }
      }
      return d;
    });
  }

  /**
   * 执行单个召回通道并提供可观测降级。
   *
   * @param channel 通道名称
   * @param operation 通道查询函数
   */
  private async runChannel<T>(
    channel: Channel,
    operation: () => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await operation();
    } catch (error) {
      this.logger.warn(
        `混合检索 ${channel} 通道失败`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
  }
}
