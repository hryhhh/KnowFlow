import { Module } from '@nestjs/common';
import { WorkerHealthService } from './worker-health.service';

@Module({
  providers: [WorkerHealthService],
  exports: [WorkerHealthService],
})
export class WorkerHealthModule {}
