import { Module } from '@nestjs/common';
import { CoreModule, WorkflowRegistry } from '@app/core';
import { EchoModule } from './echo/echo.module';
import { EchoWorkflow } from './echo/echo.workflow';

@Module({
  imports: [CoreModule, EchoModule],
  providers: [
    {
      provide: WorkflowRegistry,
      useFactory: (echoWorkflow: EchoWorkflow): WorkflowRegistry => {
        const registry = new WorkflowRegistry();
        registry.register(EchoWorkflow.TYPE, echoWorkflow);
        return registry;
      },
      inject: [EchoWorkflow],
    },
  ],
  exports: [WorkflowRegistry],
})
export class WorkflowsModule {}
