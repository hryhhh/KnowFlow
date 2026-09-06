import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { HttpExceptionFilter, AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TraceIdInterceptor } from './modules/agents/interceptor/trace-id.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // Disable ETag — JSON API responses should not be cached with ETag
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('etag', false);

  // Security headers
  app.use(helmet());

  // CORS — allow specific origins via env (comma-separated), fallback: allow all
  const allowedOrigins = env.app.corsAllowedOrigins;
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    credentials: true,
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(), new HttpExceptionFilter());
  // 全局 trace_id 拦截器：为每个请求注入 request.traceId
  app.useGlobalInterceptors(new TraceIdInterceptor());

  const port = env.app.port;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 KnowBase X server listening on http://localhost:${port}`);
  console.log(`💊 Health check: http://localhost:${port}/api/health`);
}

bootstrap();
