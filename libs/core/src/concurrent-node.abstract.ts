import { Injectable } from '@nestjs/common';
import { Node } from './node.abstract';

/**
 * Base class for nodes that act as a concurrent fan-out coordinator.
 * Nodes in `NodeConfig.concurrentNodes` are run in parallel by the workflow engine.
 * The concrete class may override `process()` for setup/teardown.
 */
@Injectable()
export abstract class ConcurrentNode extends Node {}
