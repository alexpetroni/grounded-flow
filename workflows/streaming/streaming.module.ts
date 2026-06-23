import { Module } from '@nestjs/common';
import { LlmModule } from '@app/llm';
import { StreamingChatNode } from './streaming.nodes';
import { StreamingWorkflow } from './streaming.workflow';

@Module({
  imports: [LlmModule],
  providers: [StreamingChatNode, StreamingWorkflow],
  exports: [StreamingWorkflow],
})
export class StreamingModule {}
