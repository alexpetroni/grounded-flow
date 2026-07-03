import { describe, it, expect } from 'vitest';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WorkflowRegistry } from '@app/core';
import { WorkflowsModule } from './workflows.module';
import { EchoWorkflow } from './echo/echo.workflow';
import { StreamingWorkflow } from './streaming/streaming.workflow';
import { CompositeWorkflow } from './composite/composite.workflow';

// Regression test for two DI-wiring bugs that only surfaced when the worker
// booted for real (webpack build + NestFactory), never in specs that
// construct nodes/workflows by hand: (1) WorkflowsModule tried to re-export a
// provider it didn't own instead of re-exporting CoreModule, which Nest
// rejects at module-scan time; (2) SubWorkflowNode took its WorkflowRegistry
// dependency via `import type`, which erases the constructor's runtime
// design:paramtypes metadata and made Nest see an undefined dependency.
describe('WorkflowsModule (real Nest DI boot)', () => {
  it('compiles and registers every workflow', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkflowsModule] }).compile();
    await moduleRef.init();
    const registry = moduleRef.get(WorkflowRegistry);

    expect(registry.resolve(EchoWorkflow.TYPE)).toBeInstanceOf(EchoWorkflow);
    expect(registry.resolve(StreamingWorkflow.TYPE)).toBeInstanceOf(StreamingWorkflow);
    expect(registry.resolve(CompositeWorkflow.TYPE)).toBeInstanceOf(CompositeWorkflow);

    await moduleRef.close();
  });

  it('lets a consumer module inject WorkflowRegistry after only importing WorkflowsModule', async () => {
    @Injectable()
    class Consumer {
      constructor(readonly registry: WorkflowRegistry) {}
    }

    @Module({ imports: [WorkflowsModule], providers: [Consumer] })
    class ConsumerModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ConsumerModule] }).compile();
    await moduleRef.init();
    const consumer = moduleRef.get(Consumer);

    expect(consumer.registry.resolve(EchoWorkflow.TYPE)).toBeInstanceOf(EchoWorkflow);

    await moduleRef.close();
  });
});
