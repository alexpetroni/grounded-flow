import { z } from 'zod';

export const createEventSchema = z.object({
  workflowType: z.string().min(1, 'workflowType is required'),
  data: z.record(z.unknown()).or(z.unknown()),
});

export type CreateEventDto = z.infer<typeof createEventSchema>;

export interface EventResponseDto {
  eventId: string;
  status: string;
  result?: unknown;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
