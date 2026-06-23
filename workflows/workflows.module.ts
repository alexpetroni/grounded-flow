import { Module } from '@nestjs/common';
import { CoreModule, WorkflowRegistry } from '@app/core';
import { EchoModule } from './echo/echo.module';
import { EchoWorkflow } from './echo/echo.workflow';
import { StreamingModule } from './streaming/streaming.module';
import { StreamingWorkflow } from './streaming/streaming.workflow';

@Module({
  imports: [CoreModule, EchoModule, StreamingModule],
  providers: [
    {
      provide: WorkflowRegistry,
      useFactory: (echoWorkflow: EchoWorkflow, streamingWorkflow: StreamingWorkflow): WorkflowRegistry => {
        const registry = new WorkflowRegistry();
        registry.register(EchoWorkflow.TYPE, echoWorkflow);
        registry.register(StreamingWorkflow.TYPE, streamingWorkflow);
        return registry;
      },
      inject: [EchoWorkflow, StreamingWorkflow],
    },
  ],
  exports: [WorkflowRegistry],
})
export class WorkflowsModule {}
