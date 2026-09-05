import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReadFileTool } from './read-file.tool';
import * as fs from 'node:fs';

describe('ReadFileTool', () => {
  const tool = new ReadFileTool();
  const ctx = {
    runId: 'r1',
    sessionId: 's1',
    kbId: 'kb1',
    signal: new AbortController().signal,
    emitEvent: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.UPLOADS_DIR;
    // 默认放行 realpath（返回原路径），由具体用例覆盖
    vi.spyOn(fs.promises, 'realpath').mockImplementation(async (p: any) => p as any);
  });

  it('name 正确', () => {
    expect(tool.name).toBe('read_file');
  });

  it('正常读取文件', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValueOnce({
      isFile: () => true,
      size: 11,
    } as any);
    const mockReadFile = vi
      .spyOn(fs.promises, 'readFile')
      .mockResolvedValueOnce('hello world' as any);
    const result = await tool.execute({ path: 'doc.txt' }, ctx);
    expect(result.isError).toBe(false);
    expect(result.content).toBe('hello world');
    expect(result.structured?.size).toBe(11);
    expect(mockReadFile).toHaveBeenCalled();
  });

  it('路径穿越被拦截', async () => {
    const mockReadFile = vi.spyOn(fs.promises, 'readFile');
    const result = await tool.execute({ path: '../etc/passwd' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('PATH_TRAVERSAL');
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('绝对路径穿越被拦截', async () => {
    const result = await tool.execute({ path: '/etc/passwd' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('PATH_TRAVERSAL');
  });

  it('兄弟目录前缀绕过被拦截（uploads2 ≠ uploads）', async () => {
    // path.resolve(process.cwd(), 'uploads') 下的 ../uploads2/secret 解析为
    // <cwd>/uploads2/secret，startsWith 前缀校验会放行，relative 校验必须拦截
    const result = await tool.execute({ path: '../uploads2/secret.txt' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('PATH_TRAVERSAL');
  });

  it('符号链接指向 uploads 外时被拦截', async () => {
    vi.spyOn(fs.promises, 'realpath').mockImplementation(async (p: any) => {
      // uploads 目录解析为自身，链接目标逃逸到 /etc/passwd
      return String(p).endsWith('uploads') ? (p as any) : ('/etc/passwd' as any);
    });
    const result = await tool.execute({ path: 'link.txt' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('PATH_TRAVERSAL');
  });

  it('超过大小上限返回 FILE_TOO_LARGE', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValueOnce({
      isFile: () => true,
      size: 6 * 1024 * 1024,
    } as any);
    const result = await tool.execute({ path: 'big.csv' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('FILE_TOO_LARGE');
  });

  it('目录路径返回 FILE_READ_ERROR', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValueOnce({
      isFile: () => false,
      size: 0,
    } as any);
    const result = await tool.execute({ path: 'subdir' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('FILE_READ_ERROR');
  });

  it('readFile 抛错时返回 isError', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValueOnce({
      isFile: () => true,
      size: 10,
    } as any);
    vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('ENOENT') as any);
    const result = await tool.execute({ path: 'missing.txt' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('FILE_READ_ERROR');
  });
});
