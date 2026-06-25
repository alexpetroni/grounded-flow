export { RagModule, QDRANT_CLIENT_TOKEN } from './rag.module';
export {
  IngestionService,
  EMBEDDER_TOKEN,
  VECTOR_STORE_TOKEN,
} from './ingestion/ingestion.service';
export type { IngestInput } from './ingestion/ingestion.service';
export type {
  Embedder,
  EmbedResult,
  DenseVector,
  SparseVector,
} from './embedder/embedder.interface';
export { AiSdkEmbedder } from './embedder/ai-sdk.embedder';
export { FakeEmbedder } from './embedder/fake.embedder';
export { Chunker } from './chunker/chunker';
export type { ChunkResult, ChunkerOptions } from './chunker/chunker';
export type { VectorStore, ChunkPoint, SearchResult } from './vector-store/vector-store.interface';
export { QdrantVectorStore } from './vector-store/qdrant.vector-store';
export type { DocumentLoader, LoadedDocument } from './loaders/document-loader.interface';
export { getLoader, SUPPORTED_MIME_TYPES } from './loaders/loader-registry';

// Retrieval
export { rrfFuse, DEFAULT_RRF_K } from './retrieval/rrf';
export type { RrfOptions, FusedItem } from './retrieval/rrf';
export { HybridRetriever } from './retrieval/hybrid-retriever';
export type {
  Retriever,
  RetrievedChunk,
  RetrieveOptions,
  RetrievalMode,
} from './retrieval/retriever.interface';

// Reranking
export type { Reranker, RerankedChunk } from './rerank/reranker.interface';
export { PassthroughReranker } from './rerank/passthrough.reranker';
export { FakeReranker } from './rerank/fake.reranker';
export { CohereReranker } from './rerank/cohere.reranker';
export type { CohereRerankerOptions, FetchFn } from './rerank/cohere.reranker';

// Generation + grounding
export { RagAnswerNode, RAG_INPUT_KEY } from './generation/rag-answer.node';
export type { RagGenerationInput } from './generation/rag-answer.node';
export { ragAnswerSchema, citationSchema } from './generation/rag-answer.schema';
export type { RagAnswer, Citation } from './generation/rag-answer.schema';
export { validateGrounding } from './generation/grounding';
export type { GroundedAnswer, GroundedCitation } from './generation/grounding';

// Query orchestration
export { RagQueryService } from './query/rag-query.service';
export type {
  RagQueryInput,
  RagQueryResult,
  RetrievedRef,
  RagQueryDefaults,
} from './query/rag-query.service';
export {
  RETRIEVER_TOKEN,
  RERANKER_TOKEN,
  RAG_QUERY_DEFAULTS_TOKEN,
} from './query/rag-query.tokens';
