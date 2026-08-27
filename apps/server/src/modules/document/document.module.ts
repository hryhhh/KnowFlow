import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from './entities/document.entity';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { Chunk } from '../chunk/entities/chunk.entity';
import { IngestionQueueModule } from '../ingestion/ingestion.module';
import { RetrievalModule } from '../retrieval/retrieval.module';

@Module({
  imports: [TypeOrmModule.forFeature([Document, Chunk]), IngestionQueueModule, RetrievalModule],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
