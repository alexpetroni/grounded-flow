import { Injectable } from '@nestjs/common';
import type { Workflow } from './workflow.abstract';

@Injectable()
export class WorkflowRegistry {
  private readonly registry = new Map<string, Workflow>();

  register(type: string, workflow: Workflow): void {
    this.registry.set(type, workflow);
  }

  resolve(type: string): Workflow {
    const workflow = this.registry.get(type);
    if (!workflow) {
      throw new Error(`Unknown workflow type: "${type}"`);
    }
    return workflow;
  }

  has(type: string): boolean {
    return this.registry.has(type);
  }
}
