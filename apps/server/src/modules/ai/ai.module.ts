/**
 * AI 模块：RAG 问答、文档向量索引、嵌入/生成客户端。
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiIndexProcessor } from './ai-index.processor';
import { AI_INDEX_QUEUE } from './ai.constants';
import { AiController } from './ai.controller';
import { ChatClient } from './chat.client';
import { DocumentIndexService } from './document-index.service';
import { EmbeddingClient } from './embedding.client';
import { DocumentChunk } from './entity/document-chunk.entity';
import { RagService } from './rag.service';
import { getJwtModuleOptions } from '../../config/jwt.config';
import { AuthModule } from '../auth/auth.module';
import { PgVectorStore } from './vector/pg-vector.store';
import { VECTOR_STORE } from './vector/vector-store.token';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
    TypeOrmModule.forFeature([DocumentChunk]),
    BullModule.registerQueue({ name: AI_INDEX_QUEUE }),
  ],
  controllers: [AiController],
  providers: [
    EmbeddingClient,
    ChatClient,
    RagService,
    DocumentIndexService,
    AiIndexProcessor,
    PgVectorStore,
    {
      provide: VECTOR_STORE,
      useExisting: PgVectorStore,
    },
  ],
  exports: [DocumentIndexService, EmbeddingClient, PgVectorStore, VECTOR_STORE],
})
export class AiModule {}
