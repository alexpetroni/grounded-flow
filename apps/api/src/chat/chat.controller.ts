import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { StreamingWorkflow } from '../../../../workflows/streaming/streaming.workflow';
import type { OpenAIChunk } from '@app/llm';

const chatCompletionsSchema = z.object({
  model: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    )
    .min(1),
  stream: z.boolean().default(true),
});

@Controller('v1')
export class ChatController {
  constructor(private readonly streamingWorkflow: StreamingWorkflow) {}

  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  async chatCompletions(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = chatCompletionsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const chunk of this.streamingWorkflow.runStream(parsed.data)) {
        res.write(`data: ${JSON.stringify(chunk as OpenAIChunk)}\n\n`);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }
}
