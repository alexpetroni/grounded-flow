import type { NodeConfig, WorkflowSchema } from './workflow-schema';
import type { WorkflowRegistry } from './workflow-registry';
import { isSubWorkflowReference } from './sub-workflow-node';

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

/** The tokens a config's own edge(s) point at — excludes a concurrent config's `children`. */
function edgeTargets(config: NodeConfig): string[] {
  switch (config.kind) {
    case 'router':
      return config.connections;
    case 'linear':
    case 'concurrent':
      return config.next ? [config.next] : [];
  }
}

/** Every token the engine will visit next from this config, including fan-out children. */
function allNeighbors(config: NodeConfig): string[] {
  return config.kind === 'concurrent'
    ? [...edgeTargets(config), ...config.children]
    : edgeTargets(config);
}

export class WorkflowValidator {
  /**
   * Validate a workflow schema. When a `registry` is supplied, sub-workflow
   * nodes are additionally checked: their referenced `childWorkflowType` must be
   * registered (so composition can't dangle on an unknown workflow).
   */
  validate(schema: WorkflowSchema, registry?: WorkflowRegistry): void {
    const nodeMap = this.buildNodeMap(schema);
    this.validateStartExists(schema, nodeMap);
    this.validateConnectionsExist(schema, nodeMap);
    this.validateConcurrentChildren(schema, nodeMap);
    this.validateNoCycles(schema, nodeMap);
    this.validateReachability(schema, nodeMap);
    if (registry) this.validateSubWorkflowsRegistered(schema, registry);
  }

  private validateSubWorkflowsRegistered(schema: WorkflowSchema, registry: WorkflowRegistry): void {
    for (const config of schema.nodes) {
      const node = config.node;
      if (isSubWorkflowReference(node) && !registry.has(node.childWorkflowType)) {
        throw new WorkflowValidationError(
          `Node "${config.node.token}" references unregistered sub-workflow "${node.childWorkflowType}"`,
        );
      }
    }
  }

  private buildNodeMap(schema: WorkflowSchema): Map<string, NodeConfig> {
    const map = new Map<string, NodeConfig>();
    for (const config of schema.nodes) {
      const { token } = config.node;
      if (map.has(token)) {
        throw new WorkflowValidationError(`Duplicate node token: "${token}"`);
      }
      map.set(token, config);
    }
    return map;
  }

  private validateStartExists(schema: WorkflowSchema, nodeMap: Map<string, NodeConfig>): void {
    if (!nodeMap.has(schema.start)) {
      throw new WorkflowValidationError(
        `Start node "${schema.start}" is not registered in the schema`,
      );
    }
  }

  private validateConnectionsExist(schema: WorkflowSchema, nodeMap: Map<string, NodeConfig>): void {
    for (const config of schema.nodes) {
      for (const target of edgeTargets(config)) {
        if (!nodeMap.has(target)) {
          throw new WorkflowValidationError(
            `Node "${config.node.token}" has connection to unknown node "${target}"`,
          );
        }
      }
    }
  }

  private validateConcurrentChildren(
    schema: WorkflowSchema,
    nodeMap: Map<string, NodeConfig>,
  ): void {
    // Nodes reachable only as concurrent children never have their own edges
    // followed by the engine — an edge there would validate but silently
    // never fire, so reject it up front.
    const connectionTargets = new Set(schema.nodes.flatMap((c) => edgeTargets(c)));
    for (const config of schema.nodes) {
      if (config.kind !== 'concurrent') continue;
      for (const childToken of config.children) {
        const child = nodeMap.get(childToken);
        if (!child) {
          throw new WorkflowValidationError(
            `Node "${config.node.token}" references unknown concurrentNode "${childToken}"`,
          );
        }
        if (edgeTargets(child).length > 0 && !connectionTargets.has(childToken)) {
          throw new WorkflowValidationError(
            `Concurrent node "${childToken}" declares connections, but the engine never follows a concurrent child's connections — they would silently not run`,
          );
        }
      }
    }
  }

  private validateNoCycles(schema: WorkflowSchema, nodeMap: Map<string, NodeConfig>): void {
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<string, number>();
    for (const token of nodeMap.keys()) color.set(token, WHITE);

    const dfs = (token: string): void => {
      color.set(token, GRAY);
      const config = nodeMap.get(token)!;
      for (const neighbor of allNeighbors(config)) {
        const c = color.get(neighbor);
        if (c === GRAY) {
          throw new WorkflowValidationError(
            `Cycle detected: node "${token}" has a path back to itself via "${neighbor}"`,
          );
        }
        if (c === WHITE) dfs(neighbor);
      }
      color.set(token, BLACK);
    };

    for (const token of nodeMap.keys()) {
      if (color.get(token) === WHITE) dfs(token);
    }
  }

  private validateReachability(schema: WorkflowSchema, nodeMap: Map<string, NodeConfig>): void {
    const visited = new Set<string>();
    const queue: string[] = [schema.start];

    while (queue.length > 0) {
      const token = queue.shift()!;
      if (visited.has(token)) continue;
      visited.add(token);
      const config = nodeMap.get(token)!;
      queue.push(...allNeighbors(config));
    }

    for (const token of nodeMap.keys()) {
      if (!visited.has(token)) {
        throw new WorkflowValidationError(
          `Node "${token}" is unreachable from start node "${schema.start}"`,
        );
      }
    }
  }
}
