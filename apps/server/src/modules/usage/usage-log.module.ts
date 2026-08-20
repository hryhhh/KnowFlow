import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageLog } from './entities/usage-log.entity';
import { UsageLogService } from './usage-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([UsageLog])],
  providers: [UsageLogService],
  exports: [UsageLogService],
})
export class UsageLogModule {}
