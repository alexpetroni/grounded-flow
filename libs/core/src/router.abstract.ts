import { Injectable } from '@nestjs/common';
import { Node } from './node.abstract';
import type { TaskContext } from './task-context';

@Injectable()
export abstract class BaseRouter extends Node {
  abstract route(ctx: TaskContext): string;

  async process(ctx: TaskContext): Promise<TaskContext> {
    return ctx;
  }
}
