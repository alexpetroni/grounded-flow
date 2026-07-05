import { z } from 'zod';
import { SUPPORTED_MIME_TYPES } from '@app/rag';

export const CreateDocumentDto = z.object({
  source: z.string().min(1),
  mimeType: z.enum(SUPPORTED_MIME_TYPES),
  // Node's base64 decoder silently skips invalid characters, so malformed
  // input would ingest silently-corrupted bytes — reject it at the edge.
  // Whitespace is exempt: the decoder ignores it losslessly, and MIME/PEM
  // tooling (`base64` CLI, openssl) emits line-wrapped output.
  content: z
    .string()
    .min(1, 'content must not be empty')
    .refine((v) => {
      const compact = v.replace(/\s/g, '');
      return (
        compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(compact)
      );
    }, 'content must be valid base64'),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type CreateDocumentDto = z.infer<typeof CreateDocumentDto>;
