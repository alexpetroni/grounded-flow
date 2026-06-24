export interface LoadedDocument {
  text: string;
  metadata: Record<string, unknown>;
}

export interface DocumentLoader {
  load(
    content: Buffer,
    source: string,
    metadata?: Record<string, unknown>,
  ): Promise<LoadedDocument>;
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
