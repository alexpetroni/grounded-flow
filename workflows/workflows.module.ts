import { Module, type OnModuleInit } from '@nestjs/common';
import { CoreModule, WorkflowRegistry } from '@app/core';
import { EchoModule } from './echo/echo.module';
import { EchoWorkflow } from './echo/echo.workflow';
import { StreamingModule } from './streaming/streaming.module';
import { StreamingWorkflow } from './streaming/streaming.workflow';
import { CompositeWorkflow } from './composite/composite.workflow';
import { EchoSubWorkflowNode, SummarizeNode } from './composite/composite.nodes';

@Module({
  imports: [CoreModule, EchoModule, StreamingModule],
  providers: [EchoSubWorkflowNode, SummarizeNode, CompositeWorkflow],
  // Nest only allows exporting a provider token that this module itself
  // declares in `providers` — re-exporting a provider that merely came in
  // via `imports` (WorkflowRegistry, owned by CoreModule) requires
  // re-exporting the whole module instead.
  exports: [CoreModule],
})
export class WorkflowsModule implements OnModuleInit {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly echoWorkflow: EchoWorkflow,
    private readonly streamingWorkflow: StreamingWorkflow,
    private readonly compositeWorkflow: CompositeWorkflow,
  ) {}

  // Every workflow is DI-constructed above; this just wires them into the
  // registry once construction has finished (registering earlier would race
  // against the sub-workflow node's own dependency on this registry).
  onModuleInit(): void {
    this.registry.register(EchoWorkflow.TYPE, this.echoWorkflow);
    this.registry.register(StreamingWorkflow.TYPE, this.streamingWorkflow);
    this.registry.register(CompositeWorkflow.TYPE, this.compositeWorkflow);
  }
}
