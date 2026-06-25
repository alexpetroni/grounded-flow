import type { RetrievedChunk } from '../retrieval/retriever.interface';
import type { Reranker, RerankedChunk } from './reranker.interface';

/** Minimal shape of the Cohere `/v2/rerank` response we depend on. */
interface CohereRerankResponse {
  results: Array<{ index: number; relevance_score: number }>;
}

export type FetchFn = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface CohereRerankerOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchFn?: FetchFn;
}

/**
 * Cohere Rerank cross-encoder over fused candidates. Network calls go through
 * an injectable `fetchFn` so the request/response handling is unit-testable
 * without hitting the live API.
 */
export class CohereReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(options: CohereRerankerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'rerank-v3.5';
    this.baseUrl = options.baseUrl ?? 'https://api.cohere.com';
    this.fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async rerank(
    query: string,
    candidates: RetrievedChunk[],
    topN: number,
  ): Promise<RerankedChunk[]> {
    if (candidates.length === 0) return [];

    const res = await this.fetchFn(`${this.baseUrl}/v2/rerank`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: candidates.map((c) => c.text),
        top_n: Math.min(topN, candidates.length),
      }),
    });

    if (!res.ok) {
      throw new Error(`Cohere rerank failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as CohereRerankResponse;
    return data.results
      .filter((r) => r.index >= 0 && r.index < candidates.length)
      .map((r) => ({ ...candidates[r.index]!, rerankScore: r.relevance_score }));
  }
}
