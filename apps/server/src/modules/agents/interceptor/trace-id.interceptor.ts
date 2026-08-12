import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { nanoid } from "nanoid";

/**
 * TraceId 拦截器：为每个请求生成 trace_id 并注入 REQUEST 对象
 */
@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const traceId = request.headers["x-trace-id"] as string | undefined;
    // 使用请求头中的 trace_id，或生成新的
    request.traceId = traceId ?? nanoid(16);
    return next.handle();
  }
}
