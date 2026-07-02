import { z } from 'zod';

// Filter keys are allow-listed: `documentId` (payload-indexed) and
// `metadata.*` sub-keys. A free-form record would let callers filter and
// enumerate arbitrary payload fields (e.g. raw chunk `text`).
const filterKey = z
  .string()
  .refine((k) => k === 'documentId' || /^metadata\.[A-Za-z0-9_.-]+$/.test(k), {
    message: 'filter keys must be "documentId" or "metadata.<field>"',
  });

const filterValue = z.union([z.string(), z.number(), z.boolean()]);

export const RagQueryDto = z.object({
  query: z.string().min(1, 'query must not be empty'),
  topK: z.number().int().positive().max(100).optional(),
  topN: z.number().int().positive().max(100).optional(),
  filter: z.record(filterKey, filterValue).optional(),
  mode: z.enum(['hybrid', 'dense', 'sparse']).optional(),
});

export type RagQueryDto = z.infer<typeof RagQueryDto>;
