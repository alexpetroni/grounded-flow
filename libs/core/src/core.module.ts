import { Module } from '@nestjs/common';
import { WorkflowRegistry } from './workflow-registry';

@Module({
  providers: [WorkflowRegistry],
  exports: [WorkflowRegistry],
})
export class CoreModule {}
