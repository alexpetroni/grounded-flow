import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import type { TaskContext } from '@app/core';
import { AgentStreamingNode } from '@app/llm';

export const streamingEventSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    }),
  ),
  model: z.string().optional(),
  stream: z.boolean().default(true),
});

export type StreamingEvent = z.infer<typeof streamingEventSchema>;

@Injectable()
export class StreamingChatNode extends AgentStreamingNode {
  readonly token = 'StreamingChatNode';

  buildMessages(ctx: TaskContext): ModelMessage[] {
    const event = streamingEventSchema.parse(ctx.event);
    return event.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })) as ModelMessage[];
  }
}
