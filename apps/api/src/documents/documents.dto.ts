import { z } from 'zod';
import { SUPPORTED_MIME_TYPES } from '@app/rag';

export const CreateDocumentDto = z.object({
  source: z.string().min(1),
  mimeType: z.enum(SUPPORTED_MIME_TYPES),
  content: z.string().min(1, 'content must not be empty'), // base64-encoded
  metadata: z.record(z.unknown()).optional().default({}),
});

export type CreateDocumentDto = z.infer<typeof CreateDocumentDto>;
