import { Module } from '@nestjs/common';
import { CoreModule, WorkflowRegistry } from '@app/core';
import { EchoModule } from './echo/echo.module';
import { EchoWorkflow } from './echo/echo.workflow';
import { StreamingModule } from './streaming/streaming.module';
import { StreamingWorkflow } from './streaming/streaming.workflow';
import { CompositeWorkflow } from './composite/composite.workflow';
import { EchoSubWorkflowNode, SummarizeNode } from './composite/composite.nodes';

@Module({
  imports: [CoreModule, EchoModule, StreamingModule],
  providers: [
    {
      provide: WorkflowRegistry,
      useFactory: (
        echoWorkflow: EchoWorkflow,
        streamingWorkflow: StreamingWorkflow,
      ): WorkflowRegistry => {
        const registry = new WorkflowRegistry();
        registry.register(EchoWorkflow.TYPE, echoWorkflow);
        registry.register(StreamingWorkflow.TYPE, streamingWorkflow);
        // Build the composite here so its sub-workflow node shares this very
        // registry instance — composing it via DI would create a construction
        // cycle (registry ← workflow ← sub-node ← registry).
        const composite = new CompositeWorkflow(
          new EchoSubWorkflowNode(registry),
          new SummarizeNode(),
          registry,
        );
        registry.register(CompositeWorkflow.TYPE, composite);
        return registry;
      },
      inject: [EchoWorkflow, StreamingWorkflow],
    },
  ],
  exports: [WorkflowRegistry],
})
export class WorkflowsModule {}
