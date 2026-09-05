import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';

describe('TraceController', () => {
  let mockService: any;
  let controller: TraceController;

  beforeEach(() => {
    mockService = {
      get: vi.fn(),
      list: vi.fn(),
    };
    controller = new TraceController(mockService);
  });

  it('get 返回完整 trace', async () => {
    const trace = { id: 't-1', query: 'test', steps: [] };
    mockService.get.mockResolvedValue(trace);

    const result = await controller.get('t-1');
    expect(result).toEqual({ data: trace });
    expect(mockService.get).toHaveBeenCalledWith('t-1');
  });

  it('get 不存在时抛出 NotFoundException', async () => {
    mockService.get.mockResolvedValue(null);

    await expect(controller.get('not-found')).rejects.toThrow('Trace 不存在');
  });

  it('list 无参数返回默认 20 条', async () => {
    mockService.list.mockResolvedValue([{ id: 't1' }]);

    const result = await controller.list();
    expect(result).toEqual({ data: [{ id: 't1' }] });
    expect(mockService.list).toHaveBeenCalledWith(undefined, 20);
  });

  it('list 带 kbId 和 limit 参数', async () => {
    mockService.list.mockResolvedValue([]);

    await controller.list('kb-1', '5');
    expect(mockService.list).toHaveBeenCalledWith('kb-1', 5);
  });

  it('limit 超上限时钳制到 100', async () => {
    mockService.list.mockResolvedValue([]);

    await controller.list(undefined, '99999');
    expect(mockService.list).toHaveBeenCalledWith(undefined, 100);
  });

  it('limit 非数字时回退默认 20', async () => {
    mockService.list.mockResolvedValue([]);

    await controller.list(undefined, 'abc');
    expect(mockService.list).toHaveBeenCalledWith(undefined, 20);
  });
});
