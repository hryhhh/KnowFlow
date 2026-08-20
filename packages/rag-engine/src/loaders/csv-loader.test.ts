import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadCSV } from './csv-loader.js';

describe('loadCSV', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCsv(filename: string, content: string): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('should load basic CSV with header', async () => {
    const filePath = writeCsv('basic.csv', 'name,age\nAlice,30\nBob,25\n');
    const results = await loadCSV({ filePath });
    expect(results).toHaveLength(2);
    expect(results[0].pageContent).toContain('name');
    expect(results[0].pageContent).toContain('Alice');
  });

  it('should handle custom separator', async () => {
    const filePath = writeCsv('tab.csv', 'name\tage\nAlice\t30\n');
    const results = await loadCSV({ filePath, separator: '\t' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pageContent).toContain('Alice');
  });

  it('should handle specific column', async () => {
    const filePath = writeCsv('cols.csv', 'name,age,city\nAlice,30,NYC\n');
    const results = await loadCSV({ filePath, column: 'name' });
    expect(results.length).toBeGreaterThan(0);
    const content = results.map((r) => r.pageContent).join('');
    expect(content).toContain('Alice');
  });

  it('should handle empty rows', async () => {
    const filePath = writeCsv('empty-rows.csv', 'name,age\nAlice,30\n\nBob,25\n');
    const results = await loadCSV({ filePath });
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle quoted fields with commas', async () => {
    const filePath = writeCsv('quoted.csv', 'name,bio\nAlice,"Hello, world"\nBob,"Hi, there"\n');
    const results = await loadCSV({ filePath });
    expect(results.length).toBe(2);
    expect(results[0].pageContent).toContain('Hello, world');
  });

  it('should handle UTF-8 Chinese content', async () => {
    const filePath = writeCsv('chinese.csv', '姓名,年龄\n张三,30\n李四,25\n');
    const results = await loadCSV({ filePath });
    expect(results.length).toBe(2);
    expect(results[0].pageContent).toContain('张三');
  });

  it('should throw for missing file', async () => {
    const missingPath = path.join(tmpDir, 'missing.csv');
    await expect(loadCSV({ filePath: missingPath })).rejects.toThrow();
  });

  it('should handle empty file', async () => {
    const filePath = writeCsv('empty-file.csv', '');
    const results = await loadCSV({ filePath });
    // Empty CSV may return empty or single empty document
    expect(Array.isArray(results)).toBe(true);
  });
});
