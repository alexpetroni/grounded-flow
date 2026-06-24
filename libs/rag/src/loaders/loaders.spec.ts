import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextLoader } from './text.loader';
import { HtmlLoader } from './html.loader';
import { PdfLoader } from './pdf.loader';
import { getLoader, SUPPORTED_MIME_TYPES } from './loader-registry';
import { MAX_DOCUMENT_BYTES } from './document-loader.interface';

// Top-level mock so vitest hoists it before module loading
const mockGetInfo = vi.fn().mockResolvedValue({ total: 1 });
const mockGetText = vi.fn().mockResolvedValue({ text: '' });
const mockDestroy = vi.fn().mockResolvedValue(undefined);
const MockPDFParse = vi.fn().mockImplementation(() => ({
  getInfo: mockGetInfo,
  getText: mockGetText,
  destroy: mockDestroy,
}));

vi.mock('pdf-parse', () => ({ PDFParse: MockPDFParse }));

describe('TextLoader', () => {
  const loader = new TextLoader();

  it('loads plain text', async () => {
    const result = await loader.load(Buffer.from('Hello world'), 'test.txt');
    expect(result.text).toBe('Hello world');
    expect(result.metadata['source']).toBe('test.txt');
  });

  it('preserves metadata from caller', async () => {
    const result = await loader.load(Buffer.from('content'), 'file.md', { author: 'alice' });
    expect(result.metadata['author']).toBe('alice');
  });

  it('throws on empty document', async () => {
    await expect(loader.load(Buffer.from('   '), 'empty.txt')).rejects.toThrow('empty');
  });

  it('throws when document exceeds max size', async () => {
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 'a');
    await expect(loader.load(big, 'huge.txt')).rejects.toThrow('maximum size');
  });
});

describe('HtmlLoader', () => {
  const loader = new HtmlLoader();

  it('strips HTML tags', async () => {
    const html = '<html><body><h1>Title</h1><p>Content here</p></body></html>';
    const result = await loader.load(Buffer.from(html), 'test.html');
    expect(result.text).toContain('Title');
    expect(result.text).toContain('Content here');
    expect(result.text).not.toContain('<h1>');
  });

  it('decodes HTML entities', async () => {
    const html = '<p>5 &gt; 3 &amp; 1 &lt; 2</p>';
    const result = await loader.load(Buffer.from(html), 'test.html');
    expect(result.text).toContain('5 > 3 & 1 < 2');
  });

  it('strips script and style content', async () => {
    const html =
      '<html><head><style>body{color:red}</style></head><body><script>alert(1)</script><p>Real content</p></body></html>';
    const result = await loader.load(Buffer.from(html), 'test.html');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('color:red');
    expect(result.text).toContain('Real content');
  });

  it('throws on empty-after-strip HTML', async () => {
    const html = '<div></div>';
    await expect(loader.load(Buffer.from(html), 'empty.html')).rejects.toThrow('empty');
  });

  it('throws when document exceeds max size', async () => {
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 'a');
    await expect(loader.load(big, 'huge.html')).rejects.toThrow('maximum size');
  });
});

describe('getLoader (registry)', () => {
  it('returns TextLoader for text/plain', () => {
    const loader = getLoader('text/plain');
    expect(loader).toBeInstanceOf(TextLoader);
  });

  it('returns TextLoader for text/markdown', () => {
    const loader = getLoader('text/markdown');
    expect(loader).toBeInstanceOf(TextLoader);
  });

  it('returns HtmlLoader for text/html', () => {
    const loader = getLoader('text/html');
    expect(loader).toBeInstanceOf(HtmlLoader);
  });

  it('throws for unsupported MIME type', () => {
    expect(() => getLoader('application/octet-stream')).toThrow('Unsupported MIME type');
  });

  it('handles MIME type with charset parameter', () => {
    const loader = getLoader('text/plain; charset=utf-8');
    expect(loader).toBeInstanceOf(TextLoader);
  });

  it('SUPPORTED_MIME_TYPES includes expected types', () => {
    expect(SUPPORTED_MIME_TYPES).toContain('text/plain');
    expect(SUPPORTED_MIME_TYPES).toContain('text/html');
    expect(SUPPORTED_MIME_TYPES).toContain('application/pdf');
  });
});

describe('PdfLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInfo.mockResolvedValue({ total: 1 });
    mockGetText.mockResolvedValue({ text: '' });
    mockDestroy.mockResolvedValue(undefined);
  });

  it('throws when document exceeds max size', async () => {
    const loader = new PdfLoader();
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 'a');
    await expect(loader.load(big, 'huge.pdf')).rejects.toThrow('maximum size');
  });

  it('throws when PDF has no extractable text', async () => {
    mockGetText.mockResolvedValue({ text: '   ' });
    const loader = new PdfLoader();
    await expect(loader.load(Buffer.from('%PDF'), 'empty.pdf')).rejects.toThrow(
      'no extractable text',
    );
  });

  it('loads text from PDF and includes pageCount in metadata', async () => {
    mockGetInfo.mockResolvedValue({ total: 3 });
    mockGetText.mockResolvedValue({ text: 'Hello from PDF' });
    const loader = new PdfLoader();
    const result = await loader.load(Buffer.from('%PDF'), 'doc.pdf', { title: 'test' });
    expect(result.text).toBe('Hello from PDF');
    expect(result.metadata['pageCount']).toBe(3);
    expect(result.metadata['title']).toBe('test');
  });

  it('calls destroy() even when getText() throws', async () => {
    mockGetText.mockRejectedValue(new Error('parse error'));
    const loader = new PdfLoader();
    await expect(loader.load(Buffer.from('%PDF'), 'broken.pdf')).rejects.toThrow('parse error');
    expect(mockDestroy).toHaveBeenCalled();
  });
});
