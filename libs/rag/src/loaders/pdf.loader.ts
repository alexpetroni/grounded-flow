import type { DocumentLoader, LoadedDocument } from './document-loader.interface';
import { MAX_DOCUMENT_BYTES } from './document-loader.interface';

export class PdfLoader implements DocumentLoader {
  async load(
    content: Buffer,
    source: string,
    metadata: Record<string, unknown> = {},
  ): Promise<LoadedDocument> {
    if (content.length > MAX_DOCUMENT_BYTES) {
      throw new Error(`Document exceeds maximum size of ${MAX_DOCUMENT_BYTES} bytes`);
    }
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: content });
    try {
      const info = await parser.getInfo({ parsePageInfo: false });
      const pageCount = (info as { total?: number }).total ?? 0;
      const textResult = await parser.getText();
      const extractedText = textResult.text.trim();
      if (!extractedText) {
        throw new Error('PDF contains no extractable text');
      }
      return {
        text: extractedText,
        metadata: { ...metadata, source, pageCount },
      };
    } finally {
      await parser.destroy();
    }
  }
}
