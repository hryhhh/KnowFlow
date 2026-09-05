import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallHttpApiTool, isPrivateHost } from './call-http-api.tool';

describe('CallHttpApiTool', () => {
  const tool = new CallHttpApiTool();
  const mockFetch = vi.fn();
  const ctx = {
    runId: 'r1',
    sessionId: 's1',
    kbId: 'kb1',
    signal: new AbortController().signal,
    emitEvent: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockFetch.mockClear();
    delete process.env.API_CALL_ALLOWED_DOMAINS;
    delete process.env.API_CALL_ALLOW_PRIVATE;
  });

  it('name 正确', () => {
    expect(tool.name).toBe('call_http_api');
  });

  it('GET 请求成功返回响应文本', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
    });

    const result = await tool.execute({ url: 'https://api.example.com/data' }, ctx);
    expect(result.isError).toBe(false);
    expect(result.content).toBe('{"ok":true}');
    expect(result.structured?.status).toBe(200);
  });

  it('域名不在白名单中返回 DOMAIN_NOT_ALLOWED', async () => {
    vi.stubGlobal('fetch', mockFetch);
    process.env.API_CALL_ALLOWED_DOMAINS = 'allowed.com';
    const result = await tool.execute({ url: 'https://evil.com/api' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('DOMAIN_NOT_ALLOWED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('子域名在白名单中允许访问', async () => {
    vi.stubGlobal('fetch', mockFetch);
    process.env.API_CALL_ALLOWED_DOMAINS = 'example.com';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('data'),
    });

    const result = await tool.execute({ url: 'https://api.example.com/data' }, ctx);
    expect(result.isError).toBe(false);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('POST 请求携带 body', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: () => Promise.resolve('created'),
    });

    await tool.execute(
      { url: 'https://api.example.com/data', method: 'POST', body: '{"x":1}' },
      ctx,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({
        method: 'POST',
        body: '{"x":1}',
      }),
    );
  });

  it('fetch 抛错时返回 HTTP_ERROR', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await tool.execute({ url: 'https://api.example.com/data' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('HTTP_ERROR');
  });

  it('无效 URL 返回 INVALID_URL', async () => {
    vi.stubGlobal('fetch', mockFetch);
    process.env.API_CALL_ALLOWED_DOMAINS = 'example.com';
    const result = await tool.execute({ url: 'not-a-url' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('INVALID_URL');
  });

  it('非 http/https 协议返回 INVALID_URL', async () => {
    vi.stubGlobal('fetch', mockFetch);
    const result = await tool.execute({ url: 'file:///etc/passwd' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('INVALID_URL');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('默认拒绝环回/私网地址（SSRF 防护）', async () => {
    vi.stubGlobal('fetch', mockFetch);
    for (const url of [
      'http://127.0.0.1:5433/x',
      'http://localhost/admin',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://172.16.0.9/x',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/x',
    ]) {
      const result = await tool.execute({ url }, ctx);
      expect(result.isError).toBe(true);
      expect(result.error?.code).toBe('PRIVATE_NETWORK_BLOCKED');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('API_CALL_ALLOW_PRIVATE=true 时允许私网地址', async () => {
    vi.stubGlobal('fetch', mockFetch);
    process.env.API_CALL_ALLOW_PRIVATE = 'true';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('internal'),
    });
    const result = await tool.execute({ url: 'http://127.0.0.1:8080/x' }, ctx);
    expect(result.isError).toBe(false);
    expect(result.content).toBe('internal');
  });

  it('isPrivateHost 识别各类内网/环回地址', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('foo.local')).toBe(true);
    expect(isPrivateHost('10.1.2.3')).toBe(true);
    expect(isPrivateHost('172.31.255.1')).toBe(true);
    expect(isPrivateHost('192.168.0.1')).toBe(true);
    expect(isPrivateHost('169.254.1.1')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
    expect(isPrivateHost('fd00::1')).toBe(true);
    expect(isPrivateHost('fe80::1')).toBe(true);
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('api.example.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    // 以 fc/fd 开头的公网域名不应误判（仅 IPv6 字面量按 IPv6 规则判断）
    expect(isPrivateHost('fcstart-example.com')).toBe(false);
  });

  it('302 重定向到私网地址时被拦截', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 302,
      headers: {
        get: (k: string) => (k.toLowerCase() === 'location' ? 'http://127.0.0.1/steal' : null),
      },
      text: () => Promise.resolve(''),
    });
    const result = await tool.execute({ url: 'https://api.example.com/redirect' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('PRIVATE_NETWORK_BLOCKED');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('302 重定向到公网地址时正常跟随', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'location' ? 'https://api.example.com/v2/data' : null,
        },
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('final'),
      });
    const result = await tool.execute({ url: 'https://api.example.com/data' }, ctx);
    expect(result.isError).toBe(false);
    expect(result.content).toBe('final');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.example.com/v2/data');
  });
});
