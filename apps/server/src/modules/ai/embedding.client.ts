/**
 * 嵌入服务 HTTP 客户端（本机 FastAPI / 可切换云端兼容端点）。
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AI_EMBEDDING_DIMENSIONS,
  getAiEmbedConfig,
} from '../../config/ai.config';

@Injectable()
export class EmbeddingClient {
  private readonly logger = new Logger(EmbeddingClient.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * 探测嵌入服务是否可达。
   * 输入：无；输出：是否健康
   */
  async isHealthy(): Promise<boolean> {
    const cfg = getAiEmbedConfig(this.configService);
    if (!cfg) return false;
    try {
      const headers: Record<string, string> = {};
      if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
      const res = await fetch(`${cfg.baseUrl}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      return res.ok;
    } catch (error) {
      this.logger.warn('嵌入服务健康检查失败', error);
      return false;
    }
  }

  /**
   * 批量嵌入文本。
   * 输入：texts；输出：与输入等长的向量数组
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const cfg = getAiEmbedConfig(this.configService);
    if (!cfg) {
      throw new ServiceUnavailableException(
        '嵌入服务未配置（缺少 AI_EMBED_BASE_URL）',
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

    let response: Response;
    try {
      response = await fetch(`${cfg.baseUrl}/embed`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (error) {
      this.logger.error('调用嵌入服务失败', error);
      throw new ServiceUnavailableException(
        '嵌入服务不可达（请检查本机服务或 FRP）',
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        `嵌入服务错误 ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as { vectors?: number[][] };
    const vectors = data.vectors;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new ServiceUnavailableException('嵌入服务返回格式无效');
    }

    for (const vector of vectors) {
      if (!Array.isArray(vector) || vector.length !== AI_EMBEDDING_DIMENSIONS) {
        throw new ServiceUnavailableException(
          `嵌入维度必须为 ${AI_EMBEDDING_DIMENSIONS}`,
        );
      }
    }

    return vectors;
  }

  /**
   * 单条查询嵌入。
   * 输入：text；输出：向量
   */
  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    if (!vector) {
      throw new ServiceUnavailableException('嵌入服务未返回查询向量');
    }
    return vector;
  }
}
