import { describe, it, expect } from 'vitest';
import { CreateDocumentDto } from './documents.dto';

const valid = {
  source: 'a.txt',
  mimeType: 'text/plain',
  content: Buffer.from('hello world').toString('base64'),
};

describe('CreateDocumentDto content validation', () => {
  it('accepts well-formed base64', () => {
    expect(CreateDocumentDto.safeParse(valid).success).toBe(true);
  });

  // Regression: Node's base64 decoder silently skips invalid characters, so
  // raw UTF-8 posted as `content` ingested silently-corrupted bytes.
  it('rejects raw text that is not base64', () => {
    const result = CreateDocumentDto.safeParse({ ...valid, content: 'just some plain text!' });
    expect(result.success).toBe(false);
  });

  it('rejects base64 with invalid length', () => {
    const result = CreateDocumentDto.safeParse({ ...valid, content: 'abcde' });
    expect(result.success).toBe(false);
  });

  // Regression: the strict refine rejected line-wrapped/trailing-newline
  // base64 (default output of the `base64` CLI, openssl, MIME tooling) that
  // Node's decoder handles losslessly.
  it('accepts base64 with a trailing newline', () => {
    const result = CreateDocumentDto.safeParse({ ...valid, content: `${valid.content}\n` });
    expect(result.success).toBe(true);
  });

  it('accepts MIME-style line-wrapped base64', () => {
    const wrapped = Buffer.from('hello world, wrapped across lines')
      .toString('base64')
      .replace(/(.{8})/g, '$1\r\n');
    const result = CreateDocumentDto.safeParse({ ...valid, content: wrapped });
    expect(result.success).toBe(true);
  });

  it('rejects whitespace-only content', () => {
    const result = CreateDocumentDto.safeParse({ ...valid, content: '\n\n' });
    expect(result.success).toBe(false);
  });
});
