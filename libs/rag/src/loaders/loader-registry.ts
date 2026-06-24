import type { DocumentLoader } from './document-loader.interface';
import { TextLoader } from './text.loader';
import { HtmlLoader } from './html.loader';
import { PdfLoader } from './pdf.loader';

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/markdown',
]);

export function getLoader(mimeType: string): DocumentLoader {
  const normalized = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (TEXT_MIME_TYPES.has(normalized)) return new TextLoader();
  if (normalized === 'text/html') return new HtmlLoader();
  if (normalized === 'application/pdf') return new PdfLoader();
  throw new Error(`Unsupported MIME type: ${mimeType}`);
}

export const SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/markdown',
  'text/html',
  'application/pdf',
] as const;
