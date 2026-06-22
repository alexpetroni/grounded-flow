import { describe, it, expect } from 'vitest';
import { envSchema } from './env.schema';

const minimalValid = {
  DATABASE_URL: 'postgresql://rag:rag@localhost:5432/rag',
  REDIS_URL: 'redis://localhost:6379/0',
  QDRANT_URL: 'http://localhost:6333',
};

describe('envSchema', () => {
  it('parses a valid minimal env', () => {
    const result = envSchema.safeParse(minimalValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.API_PORT).toBe(8080);
      expect(result.data.NODE_ENV).toBe('development');
    }
  });

  it('rejects missing DATABASE_URL', () => {
    const result = envSchema.safeParse({ ...minimalValid, DATABASE_URL: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects missing REDIS_URL', () => {
    const result = envSchema.safeParse({ ...minimalValid, REDIS_URL: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects missing QDRANT_URL', () => {
    const result = envSchema.safeParse({ ...minimalValid, QDRANT_URL: undefined });
    expect(result.success).toBe(false);
  });

  it('accepts empty optional provider keys (graceful degradation)', () => {
    const result = envSchema.safeParse({
      ...minimalValid,
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY_APP: '',
      COHERE_API_KEY: '',
      LANGFUSE_PUBLIC_KEY: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid NODE_ENV value', () => {
    const result = envSchema.safeParse({ ...minimalValid, NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
  });

  it('coerces API_PORT from string to number', () => {
    const result = envSchema.safeParse({ ...minimalValid, API_PORT: '3000' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.API_PORT).toBe(3000);
  });
});
