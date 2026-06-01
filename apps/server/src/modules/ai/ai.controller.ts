/**
 * AI 控制器（骨架）。
 *
 * 用途：
 * - 提供 AI 功能端点占位（后续接入 OpenAI Whisper / 自研 LLM）
 *
 * 输入：HTTP 请求
 * 输出：JSON 响应
 */

import { Controller, Get } from "@nestjs/common";

@Controller("/api/ai")
export class AiController {
  /**
   * AI 模块健康端点（占位）。
   *
   * 输入：无
   * 输出：{ ok: true }
   */
  @Get("/ping")
  ping(): { ok: true } {
    return { ok: true };
  }
}

