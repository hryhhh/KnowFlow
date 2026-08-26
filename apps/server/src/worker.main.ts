import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { Logger } from '@nestjs/common';

/**
 * Worker 进程入口
 *
 * 使用 createApplicationContext() 启动，不监听 HTTP 端口，仅消费 BullMQ 队列。
 * 必须设置 NODE_ENV=production 以触发 migration 路径而非 synchronize。
 */
async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');

  try {
    const context = await NestFactory.createApplicationContext(WorkerModule);
    logger.log('Worker 进程已启动，等待队列任务...');

    // 优雅退出
    const shutdown = async (signal: string) => {
      logger.log(`收到 ${signal} 信号，正在关闭 Worker...`);
      await context.close();
      logger.log('Worker 已关闭');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Worker 启动失败', err instanceof Error ? err.stack : String(err));
    process.exit(1);
  }
}

bootstrap();
