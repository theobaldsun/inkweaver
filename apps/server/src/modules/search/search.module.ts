import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SearchHistory } from './entity/search-history.entity';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { Document } from '../documents/entity/document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SearchHistory, Document]), AuthModule, AiModule],
  providers: [SearchService],
  controllers: [SearchController],
})
export class SearchModule {}
