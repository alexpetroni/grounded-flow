/** DI tokens for the RAG query pipeline (interfaces have no runtime identity). */
export const RETRIEVER_TOKEN = Symbol('RETRIEVER');
export const RERANKER_TOKEN = Symbol('RERANKER');
export const RAG_QUERY_DEFAULTS_TOKEN = Symbol('RAG_QUERY_DEFAULTS');
