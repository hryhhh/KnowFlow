import { describe, it, expect, vi } from 'vitest';
import {
  hashCacheKey,
  sanitizeText,
  generateTraceId,
  generateAgentResultId,
  sleep,
} from './utils.js';

describe('hashCacheKey', () => {
  it('produces consistent hash for same inputs', () => {
    const hash1 = hashCacheKey('query', 'tavily', {});
    const hash2 = hashCacheKey('query', 'tavily', {});
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different query', () => {
    const hash1 = hashCacheKey('hello world', 'tavily', {});
    const hash2 = hashCacheKey('goodbye world', 'tavily', {});
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hash for different provider', () => {
    const hash1 = hashCacheKey('query', 'tavily', {});
    const hash2 = hashCacheKey('query', 'serper', {});
    expect(hash1).not.toBe(hash2);
  });

  it('normalizes whitespace', () => {
    const hash1 = hashCacheKey('hello  world', 'tavily', {});
    const hash2 = hashCacheKey('hello world', 'tavily', {});
    expect(hash1).toBe(hash2);
  });

  it('produces sha256_ prefixed result', () => {
    const hash = hashCacheKey('test', 'tavily', {});
    expect(hash).toMatch(/^sha256_[0-9a-f]+$/);
  });
});

describe('sanitizeText', () => {
  it('removes HTML tags', () => {
    expect(sanitizeText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('sanitizes phone numbers', () => {
    const result = sanitizeText('Contact 13800138000 for help');
    expect(result).toContain('[PHONE]');
    expect(result).not.toContain('13800138000');
  });

  it('sanitizes ID card numbers', () => {
    // Use a post-2000 birth year ID to avoid phone-number regex collision on "19" prefix
    const result = sanitizeText('ID: 440300200101010018');
    expect(result).toContain('[ID]');
    expect(result).not.toMatch(/\d{17}/);
  });

  it('sanitizes email addresses', () => {
    const result = sanitizeText('Email: user@example.com');
    expect(result).toContain('[EMAIL]');
    expect(result).not.toContain('@example.com');
  });
});

describe('generateTraceId', () => {
  it('returns a string of length 16', () => {
    const id = generateTraceId();
    expect(id).toHaveLength(16);
    expect(typeof id).toBe('string');
  });

  it('returns different IDs on multiple calls', () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();
    expect(id1).not.toBe(id2);
  });
});

describe('generateAgentResultId', () => {
  it('returns a string of length 8', () => {
    const id = generateAgentResultId();
    expect(id).toHaveLength(8);
    expect(typeof id).toBe('string');
  });

  it('returns different IDs on multiple calls', () => {
    const id1 = generateAgentResultId();
    const id2 = generateAgentResultId();
    expect(id1).not.toBe(id2);
  });
});

describe('sleep', () => {
  it('resolves after specified ms', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
