import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadXLSX } from './xlsx-loader.js';

describe('loadXLSX', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeXLSX(filename: string, data: unknown[][], sheetName = 'Sheet1'): string {
    const filePath = path.join(tmpDir, filename);
    const XLSX = require('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filePath);
    return filePath;
  }

  it('should load single sheet', async () => {
    const filePath = writeXLSX('single.xlsx', [
      ['name', 'age'],
      ['Alice', 30],
      ['Bob', 25],
    ]);
    const results = await loadXLSX({ filePath });
    expect(results).toHaveLength(2);
    expect(results[0].metadata.sheet).toBe('Sheet1');
    expect(results[0].metadata.rowIndex).toBe(0);
    expect(results[1].metadata.rowIndex).toBe(1);
  });

  it('should load multiple sheets', async () => {
    const filePath = path.join(tmpDir, 'multi.xlsx');
    const XLSX = require('xlsx');
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['sheet', 'data'],
      ['a', '1'],
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['sheet', 'data'],
      ['b', '2'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Sheet1');
    XLSX.utils.book_append_sheet(wb, ws2, 'Sheet2');
    XLSX.writeFile(wb, filePath);

    const results = await loadXLSX({ filePath });
    expect(results.length).toBe(2);
    const sheets = results.map((r) => r.metadata.sheet);
    expect(sheets).toContain('Sheet1');
    expect(sheets).toContain('Sheet2');
  });

  it('should load specific sheet by name', async () => {
    const filePath = path.join(tmpDir, 'named.xlsx');
    const XLSX = require('xlsx');
    const ws1 = XLSX.utils.aoa_to_sheet([['a'], ['1']]);
    const ws2 = XLSX.utils.aoa_to_sheet([['b'], ['2']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'First');
    XLSX.utils.book_append_sheet(wb, ws2, 'Second');
    XLSX.writeFile(wb, filePath);

    const results = await loadXLSX({ filePath, sheetName: 'First' });
    expect(results.length).toBe(1);
    expect(results[0].metadata.sheet).toBe('First');
  });

  it('should handle empty cells with defval', async () => {
    const filePath = writeXLSX('empty-cells.xlsx', [
      ['name', 'age'],
      ['Alice', ''],
      ['', 25],
    ]);
    const results = await loadXLSX({ filePath });
    expect(results.length).toBe(2);
    const content = results.map((r) => r.pageContent).join('');
    expect(content).toContain('name:');
  });

  it('should preserve row index in metadata', async () => {
    const filePath = writeXLSX('indices.xlsx', [['name'], ['Alice'], ['Bob'], ['Charlie']]);
    const results = await loadXLSX({ filePath });
    expect(results.length).toBe(3);
    expect(results[0].metadata.rowIndex).toBe(0);
    expect(results[1].metadata.rowIndex).toBe(1);
    expect(results[2].metadata.rowIndex).toBe(2);
  });

  it('should throw for missing file', async () => {
    const missingPath = path.join(tmpDir, 'missing.xlsx');
    await expect(loadXLSX({ filePath: missingPath })).rejects.toThrow();
  });
});
