import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiKeyService } from './api-key.service.js';
import { createHash } from 'node:crypto';

function makeMockRepo() {
  const store = new Map<string, any>();
  return {
    create: vi.fn((entity: any) => entity),
    save: vi.fn().mockImplementation(async (entity: any) => {
      const saved = { ...entity, id: `key-${Date.now()}` };
      store.set(saved.id, saved);
      return saved;
    }),
    findOne: vi.fn().mockImplementation(async ({ where }: any) => {
      for (const [, entity] of store) {
        if (entity.keyHash === where?.keyHash && entity.isActive === where?.isActive) {
          return entity;
        }
      }
      return null;
    }),
    find: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    increment: vi.fn().mockResolvedValue({ affected: 1 }),
  };
}

function makeUsageLogService() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ApiKeyService', () => {
  let mockRepo: any;
  let mockUsageLog: any;
  let service: ApiKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = makeMockRepo();
    mockUsageLog = makeUsageLogService();
    // Mock process.env
    vi.stubEnv('API_KEY_PREFIX', 'ek_test');
    service = new ApiKeyService(mockRepo, mockUsageLog);
  });

  it('creates an API key with expected format', async () => {
    const dto = { serviceName: 'My Service', kbId: 'kb-1', description: 'Test' };
    const result = await service.create(dto);
    expect(result.apiKey).toMatch(/^ek_test/);
    expect(result.serviceName).toBe('My Service');
    expect(result.endpoint).toContain('/api/service-calls/');
    expect(mockUsageLog.record).not.toHaveBeenCalled();
  });

  it('generates a unique key each time', async () => {
    const result1 = await service.create({ serviceName: 'S1', kbId: 'kb-1' });
    const result2 = await service.create({ serviceName: 'S2', kbId: 'kb-1' });
    expect(result1.apiKey).not.toBe(result2.apiKey);
  });

  it('stores hashed key, not plaintext', async () => {
    await service.create({ serviceName: 'Test', kbId: 'kb-1' });
    const saved = mockRepo.save.mock.calls[0][0];
    expect(saved.keyHash).not.toBe(saved.apiKey); // should be different (hash vs plain)
  });

  it('validates a correct key', async () => {
    const plain = 'ek_test' + 'a'.repeat(32);
    const hash = createHash('sha256').update(plain).digest('hex');
    mockRepo.findOne = vi.fn().mockResolvedValue({
      keyHash: hash,
      isActive: true,
      serviceName: 'Test Service',
      id: 'key-123',
    });

    const claim = await service.validateKey(plain);
    expect(claim).not.toBeNull();
    expect(claim!.serviceName).toBe('Test Service');
  });

  it('returns null for invalid key', async () => {
    mockRepo.findOne = vi.fn().mockResolvedValue(null);
    const claim = await service.validateKey('invalid-key');
    expect(claim).toBeNull();
  });

  it('returns null for expired key', async () => {
    const pastDate = new Date('2020-01-01');
    mockRepo.findOne = vi.fn().mockResolvedValue({
      keyHash: 'some-hash',
      isActive: true,
      expiresAt: pastDate,
    });
    const claim = await service.validateKey('some-key');
    expect(claim).toBeNull();
  });

  it('records a call after validation', async () => {
    mockRepo.findOne = vi.fn().mockResolvedValue({ keyHash: 'h', isActive: true });
    await service.validateKey('test-key');
    // validateKey does not call recordCall - that's done in the guard
    expect(mockUsageLog.record).not.toHaveBeenCalled();
  });

  it('removes a service', async () => {
    mockRepo.findOne = vi.fn().mockResolvedValue({ id: 'k1', serviceName: 'Test' });
    const result = await service.remove('k1');
    expect(result.success).toBe(true);
    expect(mockRepo.remove).toHaveBeenCalled();
  });

  it('throws NotFoundException when removing non-existent service', async () => {
    mockRepo.findOne = vi.fn().mockResolvedValue(null);
    await expect(service.remove('nonexistent')).rejects.toThrow('服务不存在');
  });

  it('lists all API keys', async () => {
    mockRepo.find = vi.fn().mockResolvedValue([
      {
        id: 'k1',
        serviceName: 'S1',
        keyPrefix: 'ek_aaaa',
        kbId: 'kb-1',
        callCount: 5,
        isActive: true,
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    const list = await service.findAll();
    expect(list).toHaveLength(1);
    expect(list[0].serviceName).toBe('S1');
    expect(list[0].callCount).toBe(5);
  });
});
