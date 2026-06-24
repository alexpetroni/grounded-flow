import type { DocumentLoader, LoadedDocument } from './document-loader.interface';
import { MAX_DOCUMENT_BYTES } from './document-loader.interface';

export class TextLoader implements DocumentLoader {
  async load(
    content: Buffer,
    source: string,
    metadata: Record<string, unknown> = {},
  ): Promise<LoadedDocument> {
    if (content.length > MAX_DOCUMENT_BYTES) {
      throw new Error(`Document exceeds maximum size of ${MAX_DOCUMENT_BYTES} bytes`);
    }
    const text = content.toString('utf-8').trim();
    if (!text) {
      throw new Error('Document is empty');
    }
    return { text, metadata: { ...metadata, source } };
  }
}
