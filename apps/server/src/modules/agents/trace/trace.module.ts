import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';
import { AgentTrace } from './entities/agent-trace.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AgentTrace])],
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
