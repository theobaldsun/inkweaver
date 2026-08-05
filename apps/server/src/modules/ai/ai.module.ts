/**
 * AI 模块：RAG 问答、文档向量索引、嵌入/生成客户端。
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { getJwtModuleOptions } from '../../config/jwt.config';
import { AuthModule } from '../auth/auth.module';
import { AI_INDEX_QUEUE } from './ai.constants';
import { AiController } from './ai.controller';
import { AiIndexProcessor } from './ai-index.processor';
import { ChatClient } from './chat.client';
import { DocumentIndexService } from './document-index.service';
import { DocumentChunk } from './entity/document-chunk.entity';
import { EmbeddingClient } from './embedding.client';
import { RagService } from './rag.service';
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
  exports: [DocumentIndexService],
})
export class AiModule {}
