import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadDocument, detectFileType } from './index.js';

// Mock both pdf-loader and agent-pdf-loader to avoid real network calls
const { mockLoadPDFWithAgentAPI, mockLoadPDF } = vi.hoisted(() => ({
  mockLoadPDFWithAgentAPI: vi.fn().mockResolvedValue(null),
  mockLoadPDF: vi.fn().mockResolvedValue([]),
}));
vi.mock('./agent-pdf-loader.js', () => ({
  loadPDFWithAgentAPI: mockLoadPDFWithAgentAPI,
}));
vi.mock('./pdf-loader.js', () => ({
  loadPDF: mockLoadPDF,
}));

describe('detectFileType', () => {
  it('should map .csv to csv', () => {
    expect(detectFileType('data.csv')).toBe('csv');
  });

  it('should map .xlsx to xlsx', () => {
    expect(detectFileType('data.xlsx')).toBe('xlsx');
  });

  it('should map .xls to xlsx', () => {
    expect(detectFileType('data.xls')).toBe('xlsx');
  });

  it('should map .pdf to pdf', () => {
    expect(detectFileType('doc.pdf')).toBe('pdf');
  });

  it('should map .docx to word', () => {
    expect(detectFileType('doc.docx')).toBe('word');
  });

  it('should map .doc to word', () => {
    expect(detectFileType('doc.doc')).toBe('word');
  });

  it('should be case-insensitive', () => {
    expect(detectFileType('data.CSV')).toBe('csv');
    expect(detectFileType('data.PDF')).toBe('pdf');
    expect(detectFileType('data.DOCX')).toBe('word');
  });

  it('should default to csv for unknown extensions', () => {
    expect(detectFileType('data.txt')).toBe('csv');
    expect(detectFileType('data.unknown')).toBe('csv');
  });

  it('should handle filenames without extension', () => {
    expect(detectFileType('filename')).toBe('csv');
  });
});

describe('loadDocument', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-test-'));
    mockLoadPDFWithAgentAPI.mockClear();
    mockLoadPDF.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeMinimalPDF(filename: string): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(
      filePath,
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n107\n%%EOF\n',
    );
    return filePath;
  }

  it('should dispatch CSV loading correctly', async () => {
    const csvPath = path.join(tmpDir, 'test.csv');
    fs.writeFileSync(csvPath, 'name,age\nAlice,30\nBob,25\n');
    const result = await loadDocument(csvPath);
    expect(result.fileType).toBe('csv');
    expect(result.documents.length).toBe(2);
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it('should dispatch XLSX loading correctly', async () => {
    const xlsxPath = path.join(tmpDir, 'test.xlsx');
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['name', 'age'],
      ['Alice', 30],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, xlsxPath);

    const result = await loadDocument(xlsxPath);
    expect(result.fileType).toBe('xlsx');
    expect(result.documents.length).toBeGreaterThan(0);
  });

  it('should accept explicit fileType parameter', async () => {
    const csvPath = path.join(tmpDir, 'test.csv');
    fs.writeFileSync(csvPath, 'col1\nval1\n');
    const result = await loadDocument(csvPath, 'csv');
    expect(result.fileType).toBe('csv');
  });

  it('should return totalChars equal to sum of document lengths', async () => {
    const csvPath = path.join(tmpDir, 'test.csv');
    fs.writeFileSync(csvPath, 'a,b\nc,d\n');
    const result = await loadDocument(csvPath);
    const sum = result.documents.reduce((s, d) => s + d.pageContent.length, 0);
    expect(result.totalChars).toBe(sum);
  });

  it('should return totalChars=0 for empty documents', async () => {
    const emptyPath = path.join(tmpDir, 'empty.csv');
    fs.writeFileSync(emptyPath, '');
    const result = await loadDocument(emptyPath);
    expect(result.totalChars).toBe(0);
  });

  it('should pass agentOptions through for mineru-agent PDF strategy', async () => {
    mockLoadPDFWithAgentAPI.mockResolvedValue(null); // triggers fallback
    mockLoadPDF.mockResolvedValue([]);

    const pdfPath = writeMinimalPDF('test.pdf');
    const result = await loadDocument(pdfPath, undefined, 'mineru-agent', {
      language: 'zh',
      enableTable: true,
      isOcr: false,
      enableFormula: true,
    });
    expect(result.fileType).toBe('pdf');
    expect(mockLoadPDFWithAgentAPI).toHaveBeenCalledWith(pdfPath, {
      language: 'zh',
      enableTable: true,
      isOcr: false,
      enableFormula: true,
    });
    // Agent returned null, should have fallen back to basic PDF
    expect(mockLoadPDF).toHaveBeenCalledWith(pdfPath);
  });

  it('should use basic strategy for PDF without agent options', async () => {
    mockLoadPDF.mockResolvedValue([]);

    const pdfPath = writeMinimalPDF('test.pdf');
    const result = await loadDocument(pdfPath, undefined, 'basic');
    expect(result.fileType).toBe('pdf');
    expect(mockLoadPDFWithAgentAPI).not.toHaveBeenCalled();
    expect(mockLoadPDF).toHaveBeenCalledWith(pdfPath);
  });

  it('should call agent API first, then fall back to basic on null', async () => {
    mockLoadPDFWithAgentAPI.mockResolvedValue(null);
    mockLoadPDF.mockResolvedValue([]);

    const pdfPath = writeMinimalPDF('test.pdf');
    await loadDocument(pdfPath, undefined, 'mineru-agent');
    expect(mockLoadPDFWithAgentAPI).toHaveBeenCalledTimes(1);
    expect(mockLoadPDF).toHaveBeenCalledTimes(1);
  });

  it('should return agent API results when available', async () => {
    const mockAgentResult = [
      { pageContent: '# Report\n\nSome content', metadata: { source: 'test.pdf' } },
    ];
    mockLoadPDFWithAgentAPI.mockResolvedValue(mockAgentResult);

    const pdfPath = writeMinimalPDF('test.pdf');
    const result = await loadDocument(pdfPath, undefined, 'mineru-agent');
    expect(result.fileType).toBe('pdf');
    expect(result.documents.length).toBe(1);
    expect(result.documents[0].pageContent).toContain('Report');
    expect(mockLoadPDF).not.toHaveBeenCalled();
  });
});
