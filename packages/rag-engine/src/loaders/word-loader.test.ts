import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { loadWord } from './word-loader.js';

describe('loadWord', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createMinimalDocx(filename: string, text: string): string {
    const filePath = path.join(tmpDir, filename);
    const zip = new AdmZip();
    zip.addFile(
      '[Content_Types].xml',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>',
      ),
    );
    zip.addFile(
      'docProps/app.xml',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"></Properties>',
      ),
    );
    zip.addFile(
      'docProps/core.xml',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"></cp:coreProperties>',
      ),
    );
    zip.addFile(
      'word/_rels/document.xml.rels',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      ),
    );
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>` +
          `</w:document>`,
      ),
    );
    zip.addFile(
      '_rels/.rels',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>',
      ),
    );
    zip.writeZip(filePath);
    return filePath;
  }

  it('should load basic DOCX', async () => {
    const filePath = createMinimalDocx('basic.docx', 'Hello World');
    const results = await loadWord(filePath);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pageContent).toContain('Hello World');
  });

  it('should set source metadata to file path', async () => {
    const filePath = createMinimalDocx('report.docx', 'Report content');
    const results = await loadWord(filePath);
    // DocxLoader sets source to the full file path
    expect(results[0].metadata.source).toBe(filePath);
  });

  it('should handle Chinese content in DOCX', async () => {
    const filePath = createMinimalDocx('chinese.docx', '这是一段中文内容');
    const results = await loadWord(filePath);
    expect(results[0].pageContent).toContain('中文内容');
  });

  it('should throw for missing file', async () => {
    const missingPath = path.join(tmpDir, 'missing.docx');
    await expect(loadWord(missingPath)).rejects.toThrow();
  });
});
