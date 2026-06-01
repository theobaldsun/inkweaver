import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { SearchHistory } from './entity/search-history.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([SearchHistory]), AuthModule],
  providers: [SearchService],
  controllers: [SearchController],
})
export class SearchModule {}