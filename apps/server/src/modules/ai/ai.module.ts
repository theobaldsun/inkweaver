/**
 * AI 模块（骨架）。
 *
 * 用途：
 * - 聚合 AI 能力：Whisper 转写、摘要、补全、问答等（初期以 HTTP 调用第三方 API）
 *
 * 输入：HTTP 请求（音频/文本）
 * 输出：转写文本/摘要/回答
 */

import { Module } from "@nestjs/common";

import { AiController } from "./ai.controller";

@Module({
  controllers: [AiController],
})
export class AiModule {}

