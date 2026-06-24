import { getEncoding } from 'js-tiktoken';

export interface ChunkResult {
  text: string;
  tokenCount: number;
  ordinal: number;
}

export interface ChunkerOptions {
  chunkTokens?: number;
  overlapTokens?: number;
  encodingName?: string;
}

const SEPARATORS = ['\n\n', '\n', '. ', ' '];

export class Chunker {
  private readonly chunkTokens: number;
  private readonly overlapTokens: number;
  private readonly encodingName: string;

  constructor(options: ChunkerOptions = {}) {
    this.chunkTokens = options.chunkTokens ?? 512;
    this.overlapTokens = options.overlapTokens ?? 64;
    this.encodingName = options.encodingName ?? 'cl100k_base';
  }

  chunk(text: string): ChunkResult[] {
    const normalized = text.trim();
    if (!normalized) return [];

    const enc = getEncoding(this.encodingName as Parameters<typeof getEncoding>[0]);
    try {
      const tokens = Array.from(enc.encode(normalized)) as number[];
      if (tokens.length === 0) return [];

      const rawChunks = this.splitIntoChunks(normalized, enc);
      return rawChunks.map((c, i) => ({
        text: c.text,
        tokenCount: c.tokenCount,
        ordinal: i,
      }));
    } finally {
      // js-tiktoken does not require explicit cleanup (pure JS, no WASM)
    }
  }

  private countTokens(text: string, enc: ReturnType<typeof getEncoding>): number {
    return enc.encode(text).length;
  }

  private splitIntoChunks(
    text: string,
    enc: ReturnType<typeof getEncoding>,
  ): Array<{ text: string; tokenCount: number }> {
    const pieces = this.recursiveSplit(text, SEPARATORS, enc);
    return this.mergeWithOverlap(pieces, enc);
  }

  private recursiveSplit(
    text: string,
    separators: string[],
    enc: ReturnType<typeof getEncoding>,
  ): string[] {
    const tokenCount = this.countTokens(text, enc);
    if (tokenCount <= this.chunkTokens) return [text];

    const [separator, ...remaining] = separators;
    // No more separators — return as-is to avoid infinite character-level recursion
    if (separator === undefined) return [text];

    const parts = text.split(separator);
    // Separator not found or splits into only one piece — try next separator
    if (parts.length <= 1) return this.recursiveSplit(text, remaining, enc);

    const result: string[] = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const sub = this.recursiveSplit(trimmed, remaining, enc);
      result.push(...sub);
    }
    return result.length > 0 ? result : [text];
  }

  private mergeWithOverlap(
    pieces: string[],
    enc: ReturnType<typeof getEncoding>,
  ): Array<{ text: string; tokenCount: number }> {
    const chunks: Array<{ text: string; tokenCount: number }> = [];
    let current: string[] = [];
    let currentTokens = 0;

    for (const piece of pieces) {
      const pieceTokens = this.countTokens(piece, enc);

      if (currentTokens + pieceTokens > this.chunkTokens && current.length > 0) {
        const chunkText = current.join(' ');
        chunks.push({ text: chunkText, tokenCount: currentTokens });

        // Build overlap: take from end of current until we have overlapTokens
        const overlapPieces: string[] = [];
        let overlapCount = 0;
        for (let i = current.length - 1; i >= 0; i--) {
          const t = this.countTokens(current[i]!, enc);
          if (overlapCount + t > this.overlapTokens) break;
          overlapPieces.unshift(current[i]!);
          overlapCount += t;
        }
        current = overlapPieces;
        currentTokens = overlapCount;
      }

      current.push(piece);
      currentTokens += pieceTokens;
    }

    if (current.length > 0) {
      const chunkText = current.join(' ');
      chunks.push({ text: chunkText, tokenCount: this.countTokens(chunkText, enc) });
    }

    return chunks;
  }
}
