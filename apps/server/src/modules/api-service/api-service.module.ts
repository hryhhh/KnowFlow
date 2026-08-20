import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from './entities/api-key.entity';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { ApiServiceController } from './api-service.controller';
import { ServiceCallController } from './service-call.controller';
import { ChatModule } from '../chat/chat.module';
import { UsageLogModule } from '../usage/usage-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), ChatModule, UsageLogModule],
  controllers: [ApiServiceController, ServiceCallController],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService],
})
export class ApiServiceModule {}
