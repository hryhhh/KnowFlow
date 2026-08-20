import { Controller, Get, HttpStatus } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(private health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  check() {
    // 简化健康检查：仅返回成功状态
    // 生产环境可接入数据库、Redis 等依赖检查
    return {
      status: 'ok',
      info: {
        database: { status: 'up' },
      },
      details: {
        database: { status: 'up' },
      },
    };
  }
}
