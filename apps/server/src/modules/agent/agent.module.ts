/**
 * Agent 模块装配：只加载已实现的内置能力，数据库结构由显式迁移提供。
 *
 * 职责：把"对话/任务"所需的全部内部能力与外部依赖聚到一起。
 * - 自身实体（agent_*）全部在此用 TypeOrmModule.forFeature 注册，供 providers 注入 Repository。
 * - 跨模块实体（Document / DocSnapshot / SyncUpdate）也在此注册：因为"保存成果"会写 documents 与同步表，
 *   不注册就拿不到这些 Repository（Nest 的 forFeature 按模块边界隔离，谁用谁注册）。
 * - 三个外部模块分别提供：Auth（用户身份与授权上下文）、Ai（RAG/向量检索/嵌入/文档索引）、Search（检索服务）。
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgentKnowledgeService } from './agent-knowledge.service';
import { AgentModelClient } from './agent-model.client';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentArtifactSource } from './entity/agent-artifact-source.entity';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import { AgentArtifact } from './entity/agent-artifact.entity';
import { AgentDocumentSave } from './entity/agent-document-save.entity';
import { AgentMessage } from './entity/agent-message.entity';
import { AgentModelCall } from './entity/agent-model-call.entity';
import { AgentRunSource } from './entity/agent-run-source.entity';
import { AgentRun } from './entity/agent-run.entity';
import { AgentThread } from './entity/agent-thread.entity';
import { AgentToolAttempt } from './entity/agent-tool-attempt.entity';
import { AgentToolCall } from './entity/agent-tool-call.entity';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { Document } from '../documents/entity/document.entity';
import { SearchModule } from '../search/search.module';
import { DocSnapshot } from '../sync/entity/doc-snapshot.entity';
import { SyncUpdate } from '../sync/entity/sync-update.entity';

@Module({
  // 依赖三件外部能力 + 实体注册：
  //   AuthModule   → 用户身份与授权（userId、ToolAuthorization 所需的 principal）
  //   AiModule     → 导出 RagService / DocumentIndexService / PgVectorStore 等，供检索与"保存后重建索引"
  //   SearchModule → 导出 SearchService，供 AgentKnowledgeService 做知识检索
  //   TypeOrmModule.forFeature([...]) → 注册本模块全部 agent_* 实体，以及保存链路要写的 documents/sync 跨模块实体
  imports: [AuthModule, AiModule, SearchModule, TypeOrmModule.forFeature([
    AgentArtifactSource, AgentArtifactVersion, AgentArtifact, AgentDocumentSave, AgentMessage, AgentModelCall, AgentRunSource, AgentRun, AgentThread, AgentToolAttempt, AgentToolCall, Document, DocSnapshot, SyncUpdate,
  ])],
  // HTTP / SSE 入口：鉴权、参数边界、事件流推送都在这一层，不承载具体业务。
  controllers: [AgentController],
  // 核心业务 Provider：AgentService（submit/cancel/tick 调度循环）、AgentKnowledgeService（检索）、AgentModelClient（模型调用封装）。
  providers: [AgentModelClient, AgentKnowledgeService, AgentService],
})
export class AgentModule {}
