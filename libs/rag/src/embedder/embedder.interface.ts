export interface DenseVector {
  values: number[];
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface EmbedResult {
  dense: DenseVector;
  sparse: SparseVector;
}

export interface Embedder {
  embed(texts: string[]): Promise<EmbedResult[]>;
  readonly dimensions: number;
}
