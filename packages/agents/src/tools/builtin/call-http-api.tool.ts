import type { Tool, ToolContext, ToolResult } from '../base-tool';

/** 重定向最大跟随次数 */
const MAX_REDIRECTS = 3;

/**
 * 判断 host 是否为私网/环回/链路本地地址（SSRF 防护）。
 * 仅处理字面量：域名形式的内网地址依赖 DNS 解析，fetch 层无法可靠拦截（残余风险见下），
 * DNS rebinding 不在本工具的防护范围内。
 */
export function isPrivateHost(hostname: string): boolean {
  // URL.hostname 对 IPv6 字面量带方括号（[::1]），需先剥离
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    return true;
  }
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  // IPv6 字面量：环回、未指定、唯一本地（fc00::/7）、链路本地（fe80::/10）
  if (h.includes(':')) {
    return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }
  return false;
}

/**
 * call_http_api 工具 — 调用外部 HTTP API（GET/POST）
 *
 * 安全约束：
 * 1. 域名白名单（API_CALL_ALLOWED_DOMAINS，逗号分隔；留空则不限制公网域名）
 * 2. 默认拒绝私网/环回/链路本地地址，API_CALL_ALLOW_PRIVATE=true 可显式放开
 * 3. 重定向手动跟随并逐跳重新校验，防止白名单域名 302 跳转内网
 */
export class CallHttpApiTool implements Tool {
  readonly name = 'call_http_api';
  readonly description =
    '调用外部 HTTP API（GET/POST）。适用于需要获取外部系统数据的场景。不支持访问内网地址。';
  readonly parameters = {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: {
        type: 'string',
        enum: ['GET', 'POST'],
        default: 'GET',
        description: 'HTTP 方法',
      },
      headers: {
        type: 'object',
        description: '自定义请求头',
      },
      body: {
        type: 'string',
        description: '请求体（POST 时有效）',
      },
    },
    required: ['url'],
  };

  /** 白名单 + 私网防护，返回 null 表示放行 */
  private checkHost(hostname: string, allowedDomains: string[]): ToolResult | null {
    if (process.env.API_CALL_ALLOW_PRIVATE !== 'true' && isPrivateHost(hostname)) {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: {
          message: `禁止访问内网/环回地址 ${hostname}`,
          code: 'PRIVATE_NETWORK_BLOCKED',
        },
      };
    }
    if (
      allowedDomains.length > 0 &&
      !allowedDomains.some((d) => hostname === d || hostname.endsWith('.' + d))
    ) {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: {
          message: `域名 ${hostname} 不在白名单中`,
          code: 'DOMAIN_NOT_ALLOWED',
        },
      };
    }
    return null;
  }

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const allowedDomains = (process.env.API_CALL_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let currentUrl: URL;
    try {
      currentUrl = new URL(args.url);
    } catch {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: { message: '无效的 URL', code: 'INVALID_URL' },
      };
    }
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: { message: '仅支持 http/https 协议', code: 'INVALID_URL' },
      };
    }

    try {
      let method: string = args.method ?? 'GET';
      let body: string | undefined = method === 'POST' ? args.body : undefined;
      let response: Response | undefined;

      // redirect:'manual' — 每一跳都重新做 host 校验，防止白名单域名 302 到内网
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const guard = this.checkHost(currentUrl.hostname, allowedDomains);
        if (guard) return guard;

        response = await fetch(currentUrl.toString(), {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...args.headers,
          },
          body,
          signal: ctx.signal,
          redirect: 'manual',
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;
          if (hop === MAX_REDIRECTS) {
            return {
              toolCallId: '',
              content: '',
              isError: true,
              error: { message: '重定向次数超过上限', code: 'HTTP_ERROR' },
            };
          }
          currentUrl = new URL(location, currentUrl);
          // 301/302/303 语义上后续请求改为 GET
          if ([301, 302, 303].includes(response.status)) {
            method = 'GET';
            body = undefined;
          }
          continue;
        }
        break;
      }

      response = response!;
      if (!response.ok) {
        const text = await response.text();
        return {
          toolCallId: '',
          content: text,
          isError: true,
          error: { message: `HTTP ${response.status}`, code: 'HTTP_ERROR' },
          structured: { status: response.status },
        };
      }
      const text = await response.text();
      return {
        toolCallId: '',
        content: text,
        isError: false,
        structured: { status: response.status },
      };
    } catch (err) {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: {
          message: err instanceof Error ? err.message : String(err),
          code: 'HTTP_ERROR',
        },
      };
    }
  }
}
