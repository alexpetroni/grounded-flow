import Dockerode from 'dockerode';
import type { GenericContainer, StartedTestContainer } from 'testcontainers';

/**
 * Shared Testcontainers plumbing for the `rag_default` compose network.
 *
 * When the tests run inside the builder container they share `rag_default`
 * with the services they spawn, so containers must be attached to that network
 * and addressed by their network IP. On a plain host (no such network) the
 * standard Testcontainers exposed-port strategy applies. This module replaces
 * the detection/attach/endpoint boilerplate that was duplicated across every
 * integration/e2e spec.
 */
const RAG_NETWORK = 'rag_default';

type NetworkRef = Parameters<GenericContainer['withNetwork']>[0];

export interface RagNetwork {
  id: string;
  ref: NetworkRef;
}

/** Detect the compose network; null on a plain host or without socket access. */
export async function detectRagNetwork(): Promise<RagNetwork | null> {
  try {
    const docker = new Dockerode();
    const nets = await docker.listNetworks({ filters: JSON.stringify({ name: [RAG_NETWORK] }) });
    const id = nets[0]?.Id;
    if (!id) return null;
    return {
      id,
      ref: { getId: () => id, getName: () => RAG_NETWORK } as unknown as NetworkRef,
    };
  } catch {
    return null;
  }
}

/** Attach to `rag_default` (with an alias) when present, else expose `port`. */
export function attachOrExpose<T extends GenericContainer>(
  builder: T,
  net: RagNetwork | null,
  alias: string,
  port: number,
): T {
  return net
    ? (builder.withNetwork(net.ref).withNetworkAliases(alias) as T)
    : (builder.withExposedPorts(port) as T);
}

/** The host/port to reach a started container from this process. */
export async function endpointOf(
  container: StartedTestContainer,
  net: RagNetwork | null,
  port: number,
): Promise<{ host: string; port: number }> {
  if (net) {
    const docker = new Dockerode();
    const info = await docker.getContainer(container.getId()).inspect();
    return {
      host: info.NetworkSettings.Networks[RAG_NETWORK]?.IPAddress ?? container.getHost(),
      port,
    };
  }
  return { host: container.getHost(), port: container.getMappedPort(port) };
}
