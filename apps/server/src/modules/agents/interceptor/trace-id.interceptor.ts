import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { nanoid } from "nanoid";

/**
 * TraceIdInterceptor — 为每个 HTTP 请求生成或复用 trace_id
 * 注入到 request.traceId，贯穿所有日志与 SSE 事件
 */
@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    // 优先使用请求头中的 trace_id，否则生成新的
    request.traceId = (request.headers["x-trace-id"] as string | undefined) ?? nanoid(16);
    return next.handle();
  }
}
