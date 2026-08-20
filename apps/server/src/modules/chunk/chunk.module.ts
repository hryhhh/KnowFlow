import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chunk } from './entities/chunk.entity';
import { Document } from '../document/entities/document.entity';
import { ChunkService } from './chunk.service';
import { ChunkController } from './chunk.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Chunk, Document])],
  controllers: [ChunkController],
  providers: [ChunkService],
  exports: [ChunkService],
})
export class ChunkModule {}
