import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from './session.service.js';
import type { SourceRef } from '@knowbase-x/rag-engine';

function makeMockRepo(
  findOneResult: any = null,
  saveResult: any = null,
  findResult: any[] = [],
  deleteResult: any = {},
) {
  return {
    findOne: vi.fn().mockResolvedValue(findOneResult),
    create: vi.fn((entity: any) => entity),
    save: vi.fn().mockImplementation(async (entity: any) => {
      return saveResult ?? { ...entity, id: entity.id ?? `session-${Date.now()}` };
    }),
    find: vi.fn().mockResolvedValue(findResult),
    delete: vi.fn().mockResolvedValue(deleteResult),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    })),
  };
}

describe('SessionService', () => {
  let sessionRepo: any;
  let messageRepo: any;
  let service: SessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionRepo = makeMockRepo();
    messageRepo = makeMockRepo();
    service = new SessionService(sessionRepo, messageRepo);
  });

  it('lists sessions for a KB', async () => {
    const sessions = [
      { id: 's1', kbId: 'kb-1', title: 'Session 1', createdAt: new Date('2026-01-01') },
      { id: 's2', kbId: 'kb-1', title: 'Session 2', createdAt: new Date('2026-01-02') },
    ];
    sessionRepo.find.mockResolvedValue(sessions);
    messageRepo.createQueryBuilder.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    });

    const result = await service.list('kb-1');
    expect(result).toHaveLength(2);
    expect(result[0].kbId).toBe('kb-1');
  });

  it('returns empty array when no sessions', async () => {
    sessionRepo.find.mockResolvedValue([]);
    const result = await service.list('kb-1');
    expect(result).toHaveLength(0);
  });

  it('creates a session with truncated title', async () => {
    const longQuery = 'A'.repeat(50);
    const session = await service.create('kb-1', longQuery);
    expect(session.kbId).toBe('kb-1');
    expect(session.title).toHaveLength(31); // 30 chars + ellipsis
  });

  it('creates a session with full title for short query', async () => {
    const session = await service.create('kb-1', 'Hello');
    expect(session.title).toBe('Hello');
  });

  it('gets a session by ID', async () => {
    const session = { id: 's1', kbId: 'kb-1', title: 'Test' };
    sessionRepo.findOne.mockResolvedValue(session);
    const result = await service.get('s1');
    expect(result).toEqual(session);
  });

  it('returns null for non-existent session', async () => {
    sessionRepo.findOne.mockResolvedValue(null);
    const result = await service.get('nonexistent');
    expect(result).toBeNull();
  });

  it('adds a message to a session', async () => {
    const msg = await service.addMessage('s1', 'user', 'Hello');
    expect(msg.sessionId).toBe('s1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
  });

  it('includes sources when adding a message', async () => {
    const sources: SourceRef[] = [{ content: 'doc1', sourceFile: 'a.txt', score: 0.9 }];
    const msg = await service.addMessage('s1', 'assistant', 'Answer', sources);
    expect(msg.sources).toEqual(sources);
  });

  it('gets messages ordered by creation time', async () => {
    const messages = [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'user',
        content: 'Hi',
        sources: null,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'm2',
        sessionId: 's1',
        role: 'assistant',
        content: 'Hello',
        sources: null,
        createdAt: new Date('2026-01-02'),
      },
    ];
    messageRepo.find.mockResolvedValue(messages);
    const result = await service.getMessages('s1');
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  it('removes a session and its messages', async () => {
    const session = { id: 's1', kbId: 'kb-1' };
    sessionRepo.findOne.mockResolvedValue(session);

    await service.remove('s1');
    expect(messageRepo.delete).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(sessionRepo.remove).toHaveBeenCalledWith(session);
  });

  it('throws NotFoundException when removing non-existent session', async () => {
    sessionRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('nonexistent')).rejects.toThrow('会话不存在');
  });

  it('clears all sessions for a KB', async () => {
    const sessions = [
      { id: 's1', kbId: 'kb-1' },
      { id: 's2', kbId: 'kb-1' },
    ];
    sessionRepo.find.mockResolvedValue(sessions);

    await service.clearAll('kb-1');
    expect(messageRepo.delete).toHaveBeenCalledTimes(2);
    expect(sessionRepo.delete).toHaveBeenCalledWith({ kbId: 'kb-1' });
  });

  it('handles timezone conversion in list', async () => {
    const cstDate = new Date('2026-01-15T10:00:00+08:00');
    const sessions = [{ id: 's1', kbId: 'kb-1', title: 'Test', createdAt: cstDate }];
    sessionRepo.find.mockResolvedValue(sessions);
    messageRepo.createQueryBuilder.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    });

    const result = await service.list('kb-1');
    expect(result[0].createdAt).toContain('2026-01-15');
  });
});
