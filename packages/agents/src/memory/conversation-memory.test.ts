import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationMemory } from './conversation-memory';

describe('ConversationMemory', () => {
  const mockLoader = {
    load: vi.fn(),
  };
  let memory: ConversationMemory;

  beforeEach(() => {
    mockLoader.load.mockClear();
    memory = new ConversationMemory(mockLoader);
  });

  it('sessionId 为 null 返回空数组', async () => {
    const result = await memory.load(null);
    expect(result).toEqual([]);
    expect(mockLoader.load).not.toHaveBeenCalled();
  });

  it('正常加载消息', async () => {
    mockLoader.load.mockResolvedValue([
      { role: 'user', content: '问题1' },
      { role: 'assistant', content: '回答1' },
    ]);

    const result = await memory.load('sess-1', 6);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: '问题1' });
    expect(result[1]).toEqual({ role: 'assistant', content: '回答1' });
    expect(mockLoader.load).toHaveBeenCalledWith('sess-1', 6);
  });

  it('异常时返回空数组不阻塞', async () => {
    mockLoader.load.mockRejectedValue(new Error('DB error'));

    const result = await memory.load('sess-1');
    expect(result).toEqual([]);
  });

  it('maxMessages 默认 6', async () => {
    mockLoader.load.mockResolvedValue([]);
    await memory.load('sess-1');
    expect(mockLoader.load).toHaveBeenCalledWith('sess-1', 6);
  });
});
