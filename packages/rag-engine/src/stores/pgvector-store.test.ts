import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteByDocId } from './pgvector-store.js';

// Top-level mock for pg
const mockQueryFn = vi.fn();
vi.mock('pg', () => ({
  Pool: class MockPool {
    async query(sql: string, params?: any[]) {
      return mockQueryFn(sql, params);
    }
    async end() {}
  },
}));

const mockDbConfig = {
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'testdb',
};

describe('deleteByDocId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return deleted count', async () => {
    mockQueryFn.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '1' }] };
      if (sql.includes('DELETE')) return { rowCount: 3 };
      return { rows: [] };
    });

    const result = await deleteByDocId(mockDbConfig, 'langchainjs', 'doc-123');
    expect(result.deleted).toBe(3);
  });

  it('should skip deletion when metadata has no docId key', async () => {
    mockQueryFn.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '0' }] };
      return { rows: [] };
    });

    const result = await deleteByDocId(mockDbConfig, 'langchainjs', 'doc-123');
    expect(result.deleted).toBe(0);
  });

  it('should use parameterized SQL to prevent injection', async () => {
    const capturedParams: any[] = [];
    mockQueryFn.mockImplementation(async (sql: string, params?: any[]) => {
      capturedParams.push(params || []);
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '1' }] };
      if (sql.includes('DELETE')) return { rowCount: 1 };
      return { rows: [] };
    });

    await deleteByDocId(mockDbConfig, 'langchainjs', 'doc-123');

    // Should have called with params containing docId
    expect(capturedParams.length).toBeGreaterThan(0);
    const deleteCall = capturedParams.find((p) => p && p[0] === 'doc-123');
    expect(deleteCall).toBeDefined();
  });
});
