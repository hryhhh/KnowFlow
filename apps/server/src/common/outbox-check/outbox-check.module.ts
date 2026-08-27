import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../../modules/document/entities/document.entity';
import { Chunk } from '../../modules/chunk/entities/chunk.entity';
import { OutboxComplianceService } from './outbox-compliance.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document, Chunk])],
  providers: [OutboxComplianceService],
  exports: [OutboxComplianceService],
})
export class OutboxCheckModule {}
