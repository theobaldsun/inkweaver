/** Agent 模块装配：只加载已实现的内置能力，数据库结构由显式迁移提供。 */
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
  imports: [AuthModule, AiModule, SearchModule, TypeOrmModule.forFeature([
    AgentArtifactSource, AgentArtifactVersion, AgentArtifact, AgentDocumentSave, AgentMessage, AgentModelCall, AgentRunSource, AgentRun, AgentThread, AgentToolAttempt, AgentToolCall, Document, DocSnapshot, SyncUpdate,
  ])],
  controllers: [AgentController],
  providers: [AgentModelClient, AgentKnowledgeService, AgentService],
})
export class AgentModule {}
