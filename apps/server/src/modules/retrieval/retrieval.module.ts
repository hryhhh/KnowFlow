import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../../modules/document/entities/document.entity';
import { RetrievalService } from './retrieval.service';
import { RetrievalController } from './retrieval.controller';
import { UsageLogModule } from '../usage/usage-log.module';
import { RetrievalCacheService } from './retrieval-cache.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document]), UsageLogModule],
  controllers: [RetrievalController],
  providers: [RetrievalService, RetrievalCacheService],
  exports: [RetrievalService, RetrievalCacheService],
})
export class RetrievalModule {}
