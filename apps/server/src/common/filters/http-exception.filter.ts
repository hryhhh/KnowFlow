import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";

interface ErrorBody {
  code: number;
  message: string;
  details?: unknown;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const res = exception.getResponse() as
      | string
      | { message?: string | string[]; error?: string };

    let message = exception.message;
    if (typeof res === "object" && res !== null) {
      if (Array.isArray(res.message)) message = res.message.join(", ");
      else if (res.message) message = res.message;
    }

    const body: ErrorBody = { code: status, message };
    response.status(status).json(body);
  }
}

// 兜底：捕获所有非 HttpException
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof Error ? exception.message : "服务器内部错误";
    response.status(status).json({ code: status, message });
  }
}
