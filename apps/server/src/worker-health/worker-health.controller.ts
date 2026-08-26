import { Controller, Get, Injectable } from '@nestjs/common';
import { WorkerHealthService } from './worker-health.service';
import { HealthCheck, HealthCheckService, HttpHealthIndicator } from '@nestjs/terminus';
import { DOCUMENT_INGEST_QUEUE_NAME } from '../modules/ingestion/ingestion.constants';

/**
 * Worker 专用健康检查 Controller
 *
 * 监听内部端口 3001，仅提供 /health 端点，不暴露 API。
 * 用于 docker-compose healthcheck 检查 Worker 进程是否存活。
 */
@Injectable()
export class WorkerHealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private readonly workerHealth: WorkerHealthService,
  ) {}

  @Get('health')
  @HealthCheck()
  async check() {
    const status = await this.workerHealth.isHealthy();
    return {
      status: status.healthy ? 'ok' : 'error',
      info: status.healthy
        ? { redis: { status: 'up' }, queue: { status: 'up', activeJobs: status.activeJobs } }
        : { redis: { status: 'down', details: status.details } },
      details: status.details,
    };
  }
}
