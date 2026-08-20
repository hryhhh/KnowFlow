import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ApiKeyClaim {
  id: string;
  serviceName: string;
  kbId: string;
}

/**
 * 从请求中提取已校验的 API Key 声明。
 */
export const CurrentApiKey = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ApiKeyClaim | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKey ?? null;
  },
);
