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

    // Keep the separator attached to the preceding piece: chunk text must stay
    // a verbatim span of the source (citation quotes are sliced from it), so
    // periods/newlines must never be dropped or collapsed.
    const parts = splitKeepingSeparator(text, separator);
    // Separator not found or splits into only one piece — try next separator
    if (parts.length <= 1) return this.recursiveSplit(text, remaining, enc);

    const result: string[] = [];
    for (const part of parts) {
      result.push(...this.recursiveSplit(part, remaining, enc));
    }
    return result;
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
        // Pieces carry their separators, so plain concatenation reconstructs a
        // verbatim span; trimming the ends keeps it a substring of the source.
        const chunkText = current.join('').trim();
        if (chunkText)
          chunks.push({ text: chunkText, tokenCount: this.countTokens(chunkText, enc) });

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
      const chunkText = current.join('').trim();
      if (chunkText) chunks.push({ text: chunkText, tokenCount: this.countTokens(chunkText, enc) });
    }

    return chunks;
  }
}

/**
 * Like `String.split`, but each piece keeps its trailing separator so
 * concatenating consecutive pieces reproduces the original text verbatim.
 */
function splitKeepingSeparator(text: string, separator: string): string[] {
  const parts = text.split(separator);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const piece = i < parts.length - 1 ? parts[i]! + separator : parts[i]!;
    if (piece !== '') out.push(piece);
  }
  return out;
}
