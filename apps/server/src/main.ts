import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import {
  HttpExceptionFilter,
  AllExceptionsFilter,
} from "./common/filters/http-exception.filter";
import { TraceIdInterceptor } from "./modules/agents/interceptor/trace-id.interceptor";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");
  app.enableCors();
  app.useGlobalInterceptors(new TraceIdInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(), new HttpExceptionFilter());

  const port = process.env.SERVER_PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 KnowBase X server listening on http://localhost:${port}`);
}

bootstrap();
