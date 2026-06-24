import type { DocumentLoader, LoadedDocument } from './document-loader.interface';
import { MAX_DOCUMENT_BYTES } from './document-loader.interface';

export class HtmlLoader implements DocumentLoader {
  async load(
    content: Buffer,
    source: string,
    metadata: Record<string, unknown> = {},
  ): Promise<LoadedDocument> {
    if (content.length > MAX_DOCUMENT_BYTES) {
      throw new Error(`Document exceeds maximum size of ${MAX_DOCUMENT_BYTES} bytes`);
    }
    const html = content.toString('utf-8');
    // Strip HTML tags and decode common entities
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!text) {
      throw new Error('Document is empty after HTML stripping');
    }
    return { text, metadata: { ...metadata, source } };
  }
}
