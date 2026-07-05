import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { StreamingWorkflow, StreamingChatNode } from '@app/workflows';
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
  // OpenAI's protocol default: omitted `stream` means one JSON completion
  // body; SSE is opt-in via stream:true.
  stream: z.boolean().default(false),
});

@Controller('v1')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly streamingWorkflow: StreamingWorkflow,
    private readonly streamingChatNode: StreamingChatNode,
  ) {}

  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  async chatCompletions(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = chatCompletionsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    // OpenAI compatibility: stream:false means one JSON completion body.
    if (!parsed.data.stream) {
      const ctx = await this.streamingWorkflow.run(parsed.data);
      const output = this.streamingChatNode.readOutput(ctx);
      if (!output) {
        throw new InternalServerErrorException('chat workflow produced no output');
      }
      res.json({
        id: `chatcmpl-${ctx.traceId}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: parsed.data.model ?? 'default',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: output.text },
            finish_reason: 'stop',
          },
        ],
      });
      return;
    }

    // A disconnected client must stop the generator (break → iterator.return()
    // → the workflow's finally/cleanup) instead of streaming LLM tokens into a
    // destroyed socket to completion. 'close' may already have fired before
    // this handler ran (body parsing is async), so seed from the socket state.
    let clientGone = res.destroyed;
    res.on('close', () => {
      clientGone = true;
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const chunk of this.streamingWorkflow.runStream(parsed.data)) {
        if (clientGone) break;
        res.write(`data: ${JSON.stringify(chunk as OpenAIChunk)}\n\n`);
      }
    } catch (err) {
      // Log the real error server-side; never leak internal detail to the
      // (possibly unauthenticated) SSE consumer.
      this.logger.error(`Chat stream failed: ${err instanceof Error ? err.stack : String(err)}`);
      if (!clientGone) res.write(`data: ${JSON.stringify({ error: 'stream_error' })}\n\n`);
    }

    if (!clientGone) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}
