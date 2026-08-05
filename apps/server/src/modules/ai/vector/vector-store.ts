/**
 * 向量存储抽象：便于后期从 pgvector 迁移到 Qdrant。
 */

export interface VectorChunkRecord {
  userId: string;
  docId: string;
  chunkIndex: number;
  title: string;
  content: string;
  embedding: number[];
}

export interface SimilarityHit {
  docId: string;
  chunkIndex: number;
  title: string;
  content: string;
  score: number;
}

export interface VectorStore {
  /**
   * 替换某文档的全部切块向量。
   * 输入：chunks；输出：无
   */
  replaceDocChunks(chunks: VectorChunkRecord[]): Promise<void>;

  /**
   * 按文档删除全部切块。
   * 输入：docId；输出：无
   */
  deleteByDocId(docId: string): Promise<void>;

  /**
   * 相似度检索（必须带 userId 过滤）。
   * 输入：userId、queryEmbedding、topK、可选 docIds；输出：命中列表
   */
  similaritySearch(
    userId: string,
    queryEmbedding: number[],
    topK: number,
    docIds?: string[],
  ): Promise<SimilarityHit[]>;
}

/** 后期 Qdrant 实现占位，避免误用。 */
export class QdrantVectorStore implements VectorStore {
  async replaceDocChunks(): Promise<void> {
    throw new Error('QdrantVectorStore 尚未实现；当前请使用 PgVectorStore');
  }

  async deleteByDocId(): Promise<void> {
    throw new Error('QdrantVectorStore 尚未实现；当前请使用 PgVectorStore');
  }

  async similaritySearch(): Promise<SimilarityHit[]> {
    throw new Error('QdrantVectorStore 尚未实现；当前请使用 PgVectorStore');
  }
}
