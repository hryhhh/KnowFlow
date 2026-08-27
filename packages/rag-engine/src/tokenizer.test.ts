import { describe, it, expect } from 'vitest';
import { tokenize, tokensToTsvString, tokensToTsQuery } from './tokenizer.js';

describe('tokenize', () => {
  it('should split English words by spaces', () => {
    const result = tokenize('hello world');
    expect(result).toContain('hello');
    expect(result).toContain('world');
  });

  it('should handle mixed Chinese and English', () => {
    const result = tokenize('PostgreSQL 向量检索');
    expect(result).toContain('postgresql');
    // Chinese chars become unigrams + bigrams in fallback mode
    expect(result.some((t) => t.includes('向量'))).toBe(true);
  });

  it('should preserve error codes like E-1042', () => {
    const result = tokenize('E-1042 error');
    expect(result).toContain('e-1042');
  });

  it('should handle no-space Chinese', () => {
    const result = tokenize('怎么重置密码');
    // fallback mode: unigrams + bigrams
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('should lowercase all tokens', () => {
    const result = tokenize('Hello WORLD');
    expect(result).toContain('hello');
    expect(result).toContain('world');
  });
});

describe('tokensToTsvString', () => {
  it('should join tokens with spaces', () => {
    expect(tokensToTsvString(['如何', '重置', '密码'])).toBe('如何 重置 密码');
  });

  it('should return empty string for empty input', () => {
    expect(tokensToTsvString([])).toBe('');
  });
});

describe('tokensToTsQuery', () => {
  it('should AND-join tokens with prefix operator', () => {
    expect(tokensToTsQuery(['怎么', '重置', '密码'])).toBe("'怎么':* & '重置':* & '密码':*");
  });

  it('should return empty string for empty input', () => {
    expect(tokensToTsQuery([])).toBe('');
  });

  it('should handle single token', () => {
    expect(tokensToTsQuery(['密码'])).toBe("'密码':*");
  });
});
