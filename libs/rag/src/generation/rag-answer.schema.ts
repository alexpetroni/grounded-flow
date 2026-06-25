import { z } from 'zod';

export const citationSchema = z.object({
  chunkId: z.string(),
  quote: z.string(),
});

export const ragAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema),
  confidence: z.number().min(0).max(1),
});

export type Citation = z.infer<typeof citationSchema>;
export type RagAnswer = z.infer<typeof ragAnswerSchema>;
