import { z } from 'zod';

export const RagQueryDto = z.object({
  query: z.string().min(1, 'query must not be empty'),
  topK: z.number().int().positive().max(100).optional(),
  topN: z.number().int().positive().max(100).optional(),
  filter: z.record(z.unknown()).optional(),
  mode: z.enum(['hybrid', 'dense', 'sparse']).optional(),
});

export type RagQueryDto = z.infer<typeof RagQueryDto>;
